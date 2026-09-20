/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Intelligence Workflow Scheduler
 * ============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/intelligence/command-center/workflowScheduler.js
 *
 * Architectural role
 * ------------------
 * Durable scheduling/control-plane boundary for declarative Airtel command-
 * center workflows. The scheduler accepts validated workflow references,
 * creates tenant-scoped schedule records, applies bounded execution windows,
 * manages lifecycle state, claims due work for trusted workers, and delegates
 * actual workflow execution to an injected executor.
 *
 * Responsibilities
 * ----------------
 * - Schedule registered workflow versions for a tenant.
 * - Resolve explicit or active workflow versions through workflowRegistry.
 * - Enforce Airtel-only and tenant-scoped scheduling boundaries.
 * - Preserve workflow/version/request/idempotency identity.
 * - Maintain explicit schedule lifecycle and retry metadata.
 * - Claim due work with lease semantics for external workers.
 * - Acknowledge success/failure and calculate bounded retry plans.
 * - Cancel, pause, resume and reschedule schedules through explicit methods.
 * - Expose queue/history/status/readiness views with bounded pagination.
 * - Persist state through an injected repository.
 * - Emit safe audit/events/metrics/traces without owning infrastructure.
 *
 * Non-responsibilities / important boundaries
 * --------------------------------------------
 * - NOT a workflow executor; worker execution remains delegated.
 * - NOT an in-process cron scheduler; this module does not create background
 *   timers, intervals, worker loops or unbounded asynchronous activity.
 * - NOT an Airtel provider adapter and never owns Airtel credentials.
 * - NOT a payment authorization, settlement, ledger or financial transaction
 *   service.
 * - NOT allowed to post, settle, reverse, refund, debit, credit or mutate money.
 * - NOT an approval/maker-checker authority.
 * - NOT an AML/KYC/sanctions/fraud decision engine.
 * - NOT a retry engine for financial operations. Workflow retry metadata only
 *   controls workflow orchestration and must delegate financial retry policy to
 *   the appropriate financial/payment service.
 * - NOT the authoritative workflow-definition registry; it consumes one.
 * - NOT the authoritative incident, SLA or governance state machine.
 *
 * Production principles
 * ---------------------
 * - Provider scope is fail-closed to AIRTEL.
 * - Tenant identity is mandatory by default.
 * - Schedule records are immutable by identity but lifecycle updates are
 *   explicit state transitions with compare-and-set support at the repository.
 * - Idempotency is scoped by tenant + provider + idempotency key.
 * - Every scheduled execution carries a deterministic schedule/request
 *   fingerprint.
 * - Leases are bounded, renewable by explicit calls, and never infinite.
 * - Retry counts, delays, batch sizes and query limits are bounded.
 * - Secrets, credentials and unnecessary PII are redacted from persisted data.
 * - Workflow execution is never implied by successful scheduling/claiming.
 * - A claimed item is not a successful workflow result and never a financial
 *   settlement state.
 * - Worker execution must use the registered immutable workflow definition;
 *   callers cannot inject arbitrary code or module paths into a schedule.
 * - Returned objects are deeply frozen to prevent accidental caller mutation.
 * - In-memory persistence is test/local support only; production should inject
 *   a durable repository with atomic uniqueness/lease semantics.
 *
 * Module format
 * -------------
 * Native ECMAScript module (ESM), Node.js 24+ compatible, Node built-ins only.
 * ============================================================================
 */

import crypto from 'node:crypto';

// =============================================================================
// Identity / public enums
// =============================================================================

export const ENGINE_NAME = 'airtel-command-center-workflow-scheduler';
export const ENGINE_VERSION = '2.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const SCHEDULE_STATUS = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  READY: 'READY',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  RETRY_PENDING: 'RETRY_PENDING',
  PAUSED: 'PAUSED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  DEAD_LETTERED: 'DEAD_LETTERED',
});

export const SCHEDULE_TRIGGER = Object.freeze({
  MANUAL: 'MANUAL',
  API: 'API',
  EVENT: 'EVENT',
  SCHEDULED: 'SCHEDULED',
  ALERT: 'ALERT',
  INCIDENT: 'INCIDENT',
  SLA: 'SLA',
  GOVERNANCE: 'GOVERNANCE',
});

export const SCHEDULE_SCOPE = Object.freeze({
  TENANT: 'TENANT',
  SYSTEM: 'SYSTEM',
});

export const EXECUTION_OUTCOME = Object.freeze({
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  RETRY: 'RETRY',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'WORKFLOW_SCHEDULER_INVALID_INPUT',
  TENANT_REQUIRED: 'WORKFLOW_SCHEDULER_TENANT_REQUIRED',
  TENANT_INVALID: 'WORKFLOW_SCHEDULER_TENANT_INVALID',
  SYSTEM_SCOPE_FORBIDDEN: 'WORKFLOW_SCHEDULER_SYSTEM_SCOPE_FORBIDDEN',
  PROVIDER_SCOPE_VIOLATION: 'WORKFLOW_SCHEDULER_PROVIDER_SCOPE_VIOLATION',
  WORKFLOW_REQUIRED: 'WORKFLOW_SCHEDULER_WORKFLOW_REQUIRED',
  WORKFLOW_NOT_FOUND: 'WORKFLOW_SCHEDULER_WORKFLOW_NOT_FOUND',
  WORKFLOW_INACTIVE: 'WORKFLOW_SCHEDULER_WORKFLOW_INACTIVE',
  WORKFLOW_VERSION_INVALID: 'WORKFLOW_SCHEDULER_WORKFLOW_VERSION_INVALID',
  SCHEDULE_NOT_FOUND: 'WORKFLOW_SCHEDULER_SCHEDULE_NOT_FOUND',
  SCHEDULE_INVALID: 'WORKFLOW_SCHEDULER_SCHEDULE_INVALID',
  INVALID_TRANSITION: 'WORKFLOW_SCHEDULER_INVALID_TRANSITION',
  IDEMPOTENCY_REQUIRED: 'WORKFLOW_SCHEDULER_IDEMPOTENCY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'WORKFLOW_SCHEDULER_IDEMPOTENCY_CONFLICT',
  LEASE_INVALID: 'WORKFLOW_SCHEDULER_LEASE_INVALID',
  LEASE_EXPIRED: 'WORKFLOW_SCHEDULER_LEASE_EXPIRED',
  LEASE_CONFLICT: 'WORKFLOW_SCHEDULER_LEASE_CONFLICT',
  WORKER_REQUIRED: 'WORKFLOW_SCHEDULER_WORKER_REQUIRED',
  PAYLOAD_TOO_LARGE: 'WORKFLOW_SCHEDULER_PAYLOAD_TOO_LARGE',
  REPOSITORY_REQUIRED: 'WORKFLOW_SCHEDULER_REPOSITORY_REQUIRED',
  PERSISTENCE_FAILED: 'WORKFLOW_SCHEDULER_PERSISTENCE_FAILED',
  EXECUTOR_UNAVAILABLE: 'WORKFLOW_SCHEDULER_EXECUTOR_UNAVAILABLE',
  EXECUTOR_PROTOCOL_ERROR: 'WORKFLOW_SCHEDULER_EXECUTOR_PROTOCOL_ERROR',
  TIMEOUT: 'WORKFLOW_SCHEDULER_TIMEOUT',
  RETRY_EXHAUSTED: 'WORKFLOW_SCHEDULER_RETRY_EXHAUSTED',
  CLOSED: 'WORKFLOW_SCHEDULER_CLOSED',
  EXPORT_TOO_LARGE: 'WORKFLOW_SCHEDULER_EXPORT_TOO_LARGE',
});

const VALID_STATUS_SET = new Set(Object.values(SCHEDULE_STATUS));
const VALID_TRIGGER_SET = new Set(Object.values(SCHEDULE_TRIGGER));
const VALID_SCOPE_SET = new Set(Object.values(SCHEDULE_SCOPE));

const ACTIVE_STATUSES = new Set([
  SCHEDULE_STATUS.SCHEDULED,
  SCHEDULE_STATUS.READY,
  SCHEDULE_STATUS.RUNNING,
  SCHEDULE_STATUS.RETRY_PENDING,
  SCHEDULE_STATUS.PAUSED,
]);

const TERMINAL_STATUSES = new Set([
  SCHEDULE_STATUS.SUCCEEDED,
  SCHEDULE_STATUS.CANCELLED,
  SCHEDULE_STATUS.EXPIRED,
  SCHEDULE_STATUS.DEAD_LETTERED,
]);

const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  initialDelayMs: 5_000,
  maxDelayMs: 300_000,
  multiplier: 2,
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  systemScopeAllowed: false,
  defaultDelayMs: 0,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
  defaultLeaseMs: 60_000,
  maxLeaseMs: 10 * 60_000,
  defaultExecutionWindowMs: 15 * 60_000,
  maxExecutionWindowMs: 24 * 60 * 60_000,
  maxScheduleAheadMs: 365 * 24 * 60 * 60_000,
  maxAttempts: 10,
  maxBatchSize: 100,
  maxListLimit: 100,
  defaultListLimit: 20,
  maxHistory: 200,
  maxMetadataKeys: 50,
  maxPayloadBytes: 512 * 1024,
  maxExportBytes: 4 * 1024 * 1024,
  persistSchedules: true,
  requireRepository: false,
  failClosedOnPersistenceError: true,
  requireIdempotencyForSchedule: true,
  renewLeaseBeforeMs: 10_000,
  maxResultBytes: 512 * 1024,
});

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'set-cookie',
  'apiKey',
  'clientSecret',
  'privateKey',
  'otp',
  'pin',
  'cvv',
  'cardNumber',
  'accountNumber',
  'phoneNumber',
  'mobileNumber',
  'email',
  'nationalId',
  'nin',
]);

const SAFE_IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Date)
    && !Buffer.isBuffer(value);
}

function normalizeString(value, max = 200) {
  if (typeof value !== 'string') return '';

  const normalized = value.trim();

  return normalized
    ? normalized.slice(0, max)
    : '';
}

function normalizeTenantId(value) {
  return normalizeString(
    value,
    160,
  );
}

function normalizeProvider(value) {
  return normalizeString(
    value,
    32,
  ).toUpperCase();
}

function normalizeInteger(
  value,
  fallback,
  min,
  max,
) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.min(
    Math.max(number, min),
    max,
  );
}

function normalizeNumber(
  value,
  fallback = null,
) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function parseDate(value) {
  if (!value) return null;

  const date =
    value instanceof Date
      ? new Date(value)
      : new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function now(clock) {
  const value =
    typeof clock === 'function'
      ? clock()
      : new Date();

  return value instanceof Date
    ? value
    : new Date(value);
}

function nowIso(clock) {
  return now(clock).toISOString();
}

function stableNormalize(
  value,
  depth = 0,
) {
  if (depth > 12) {
    return '[MAX_DEPTH]';
  }

  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${value.length}]`;
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (typeof value !== 'object') {
    if (
      typeof value === 'number'
      && !Number.isFinite(value)
    ) {
      return String(value);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        stableNormalize(
          item,
          depth + 1,
        ),
    );
  }

  const output = {};

  for (
    const key of Object.keys(value).sort()
  ) {
    output[key] =
      stableNormalize(
        value[key],
        depth + 1,
      );
  }

  return output;
}

function stableStringify(value) {
  return JSON.stringify(
    stableNormalize(value),
  );
}

function sha256(value) {
  return crypto
    .createHash(HASH_ALGORITHM)
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(value),
      'utf8',
    )
    .digest('hex');
}

function redact(
  value,
  depth = 0,
  seen = new WeakSet(),
) {
  if (depth > 10) {
    return '[MAX_DEPTH]';
  }

  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${value.length}]`;
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, 250)
      .map(
        (item) =>
          redact(
            item,
            depth + 1,
            seen,
          ),
      );
  }

  const output = {};

  for (
    const [key, item]
    of Object.entries(value).slice(0, 500)
  ) {
    if (
      SENSITIVE_KEYS.has(key)
      || SENSITIVE_KEYS.has(
        key.toLowerCase(),
      )
      || /password|secret|token|authorization|cookie|private.?key|otp|pin|cvv/i.test(
        key,
      )
    ) {
      output[key] =
        item == null
          ? null
          : '[REDACTED]';

      continue;
    }

    output[key] =
      redact(
        item,
        depth + 1,
        seen,
      );
  }

  return output;
}

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    !value
    || typeof value !== 'object'
    || seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const key
    of Reflect.ownKeys(value)
  ) {
    try {
      deepFreeze(
        value[key],
        seen,
      );
    } catch {
      // Defensive best effort.
    }
  }

  try {
    Object.freeze(value);
  } catch {
    // Defensive best effort.
  }

  return value;
}

function safeBytes(value) {
  try {
    return Buffer.byteLength(
      stableStringify(
        redact(value),
      ),
      'utf8',
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function versionKey(
  workflowId,
  version,
) {
  return `${workflowId}@${version}`;
}

function tenantKey(
  tenantId,
) {
  return (
    normalizeTenantId(
      tenantId,
    )
    || '__SYSTEM__'
  );
}

function scheduleKey({
  tenantId,
  scheduleId,
}) {
  return `${tenantKey(tenantId)}:${scheduleId}`;
}

function idempotencyKey({
  tenantId,
  provider,
  idempotencyKeyValue,
}) {
  return `${tenantKey(tenantId)}:${normalizeProvider(
    provider,
  )}:${idempotencyKeyValue}`;
}

function compareScheduleTime(
  a,
  b,
) {
  const left =
    new Date(
      a.nextRunAt
      || a.createdAt
      || 0,
    ).getTime();

  const right =
    new Date(
      b.nextRunAt
      || b.createdAt
      || 0,
    ).getTime();

  return left - right;
}

function transitionAllowed(
  from,
  to,
) {
  const allowed = {
    [SCHEDULE_STATUS.SCHEDULED]:
      new Set([
        SCHEDULE_STATUS.READY,
        SCHEDULE_STATUS.RUNNING,
        SCHEDULE_STATUS.PAUSED,
        SCHEDULE_STATUS.CANCELLED,
        SCHEDULE_STATUS.EXPIRED,
      ]),

    [SCHEDULE_STATUS.READY]:
      new Set([
        SCHEDULE_STATUS.RUNNING,
        SCHEDULE_STATUS.PAUSED,
        SCHEDULE_STATUS.CANCELLED,
        SCHEDULE_STATUS.EXPIRED,
      ]),

    [SCHEDULE_STATUS.RUNNING]:
      new Set([
        SCHEDULE_STATUS.SUCCEEDED,
        SCHEDULE_STATUS.FAILED,
        SCHEDULE_STATUS.RETRY_PENDING,
        SCHEDULE_STATUS.CANCELLED,
        SCHEDULE_STATUS.EXPIRED,
      ]),

    [SCHEDULE_STATUS.FAILED]:
      new Set([
        SCHEDULE_STATUS.RETRY_PENDING,
        SCHEDULE_STATUS.DEAD_LETTERED,
        SCHEDULE_STATUS.CANCELLED,
      ]),

    [SCHEDULE_STATUS.RETRY_PENDING]:
      new Set([
        SCHEDULE_STATUS.READY,
        SCHEDULE_STATUS.RUNNING,
        SCHEDULE_STATUS.PAUSED,
        SCHEDULE_STATUS.CANCELLED,
        SCHEDULE_STATUS.EXPIRED,
      ]),

    [SCHEDULE_STATUS.PAUSED]:
      new Set([
        SCHEDULE_STATUS.READY,
        SCHEDULE_STATUS.CANCELLED,
        SCHEDULE_STATUS.EXPIRED,
      ]),

    [SCHEDULE_STATUS.SUCCEEDED]:
      new Set(),

    [SCHEDULE_STATUS.CANCELLED]:
      new Set(),

    [SCHEDULE_STATUS.EXPIRED]:
      new Set(),

    [SCHEDULE_STATUS.DEAD_LETTERED]:
      new Set(),
  };

  return Boolean(
    allowed[from]?.has(to),
  );
}

function exponentialBackoff(
  policy,
  attempt,
) {
  const exponent =
    Math.max(
      attempt - 1,
      0,
    );

  const raw =
    policy.initialDelayMs
    * (policy.multiplier ** exponent);

  return Math.min(
    raw,
    policy.maxDelayMs,
  );
}

function maxSeverityCode(
  error,
) {
  return normalizeString(
    error?.code || 'UNKNOWN',
    160,
  );
}

function hasFinancialMutationCapability(
  value,
  depth = 0,
) {
  if (
    depth > 8
    || value === null
    || value === undefined
  ) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(
      (item) =>
        hasFinancialMutationCapability(
          item,
          depth + 1,
        ),
    );
  }

  if (typeof value !== 'object') {
    return false;
  }

  const forbidden = [
    'post_payment',
    'settle_payment',
    'reverse_payment',
    'refund_payment',
    'debit_balance',
    'credit_balance',
    'mutate_ledger',
    'authorize_payment',
  ];

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    const lower =
      key.toLowerCase();

    if (
      forbidden.some(
        (item) =>
          lower.includes(item),
      )
    ) {
      return true;
    }

    if (
      hasFinancialMutationCapability(
        child,
        depth + 1,
      )
    ) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// Error type
// =============================================================================

export class WorkflowSchedulerError
  extends Error {
  constructor(
    code,
    message,
    status = 500,
    details = undefined,
    cause = undefined,
  ) {
    super(
      message,
      { cause },
    );

    this.name =
      'WorkflowSchedulerError';

    this.code =
      code;

    this.status =
      status;

    this.details =
      details;
  }
}

// =============================================================================
// In-memory repository for development/tests
// =============================================================================

export class InMemoryWorkflowSchedulerRepository {
  constructor({
    maxHistory =
      DEFAULT_CONFIG.maxHistory,
  } = {}) {
    this.maxHistory =
      normalizeInteger(
        maxHistory,
        DEFAULT_CONFIG.maxHistory,
        1,
        DEFAULT_CONFIG.maxHistory,
      );

    this.schedules =
      new Map();

    this.idempotency =
      new Map();

    this.history =
      [];
  }

  async createSchedule(
    schedule,
  ) {
    const key =
      scheduleKey(
        schedule,
      );

    if (
      this.schedules.has(
        key,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'Schedule already exists.',
        409,
      );
    }

    this.schedules.set(
      key,
      redact(schedule),
    );

    this.history.unshift({
      type:
        'SCHEDULE_CREATED',

      scheduleId:
        schedule.scheduleId,

      tenantId:
        schedule.tenantId
        || null,

      provider:
        schedule.provider,

      status:
        schedule.status,

      recordedAt:
        schedule.createdAt,
    });

    this.history =
      this.history.slice(
        0,
        this.maxHistory,
      );

    return schedule;
  }

  async getSchedule({
    tenantId,
    scheduleId,
  }) {
    return (
      this.schedules.get(
        scheduleKey({
          tenantId,
          scheduleId,
        }),
      )
      || null
    );
  }

  async updateSchedule({
    tenantId,
    scheduleId,
    update,
    expectedStatus,
    expectedLeaseToken,
  }) {
    const key =
      scheduleKey({
        tenantId,
        scheduleId,
      });

    const current =
      this.schedules.get(
        key,
      );

    if (!current) {
      return null;
    }

    if (
      expectedStatus
      && current.status
        !== expectedStatus
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.INVALID_TRANSITION,
        `Expected schedule status ${expectedStatus}, found ${current.status}.`,
        409,
      );
    }

    if (
      expectedLeaseToken
      && current.leaseToken
        !== expectedLeaseToken
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.LEASE_CONFLICT,
        'Schedule lease token does not match.',
        409,
      );
    }

    const updated = {
      ...current,
      ...redact(update),
    };

    this.schedules.set(
      key,
      updated,
    );

    this.history.unshift({
      type:
        'SCHEDULE_UPDATED',

      scheduleId,

      tenantId:
        tenantId || null,

      provider:
        current.provider,

      status:
        updated.status,

      recordedAt:
        updated.updatedAt
        || new Date().toISOString(),
    });

    this.history =
      this.history.slice(
        0,
        this.maxHistory,
      );

    return updated;
  }

  async listSchedules({
    tenantId,
    status,
    limit = 20,
    dueBefore = null,
  } = {}) {
    const normalizedTenant =
      tenantKey(
        tenantId,
      );

    const dueTime =
      dueBefore
        ? new Date(
            dueBefore,
          ).getTime()
        : null;

    const rows = [];

    for (
      const schedule
      of this.schedules.values()
    ) {
      if (
        tenantKey(
          schedule.tenantId,
        )
        !== normalizedTenant
      ) {
        continue;
      }

      if (
        status
        && schedule.status
          !== status
      ) {
        continue;
      }

      if (
        dueTime !== null
      ) {
        const nextRun =
          new Date(
            schedule.nextRunAt
            || 0,
          ).getTime();

        if (
          !Number.isFinite(
            nextRun,
          )
          || nextRun > dueTime
        ) {
          continue;
        }
      }

      rows.push(
        schedule,
      );
    }

    rows.sort(
      compareScheduleTime,
    );

    return rows.slice(
      0,
      limit,
    );
  }

  async findDueSchedules({
    tenantId,
    limit = 20,
    nowAt,
  }) {
    return this.listSchedules({
      tenantId,
      limit,
      dueBefore:
        nowAt,
    });
  }

  async getByIdempotency({
    tenantId,
    provider,
    idempotencyKey:
      keyValue,
  }) {
    return (
      this.idempotency.get(
        idempotencyKey({
          tenantId,
          provider,
          idempotencyKeyValue:
            keyValue,
        }),
      )
      || null
    );
  }

  async saveIdempotency({
    tenantId,
    provider,
    idempotencyKey:
      keyValue,
    fingerprint,
    schedule,
  }) {
    this.idempotency.set(
      idempotencyKey({
        tenantId,
        provider,
        idempotencyKeyValue:
          keyValue,
      }),
      {
        fingerprint,
        schedule:
          redact(schedule),
        recordedAt:
          new Date().toISOString(),
      },
    );
  }

  async historyList({
    tenantId,
    limit = 20,
  } = {}) {
    return this.history
      .filter(
        (item) =>
          tenantKey(
            item.tenantId,
          )
          === tenantKey(
            tenantId,
          ),
      )
      .slice(
        0,
        limit,
      );
  }

  async countByStatus({
    tenantId,
  } = {}) {
    const counts = {};

    for (
      const status
      of VALID_STATUS_SET
    ) {
      counts[status] = 0;
    }

    for (
      const schedule
      of this.schedules.values()
    ) {
      if (
        tenantKey(
          schedule.tenantId,
        )
        !== tenantKey(
          tenantId,
        )
      ) {
        continue;
      }

      counts[schedule.status] =
        (
          counts[schedule.status]
          || 0
        )
        + 1;
    }

    return counts;
  }

  async healthCheck() {
    return {
      status:
        'UP',

      schedules:
        this.schedules.size,

      idempotencyRecords:
        this.idempotency.size,
    };
  }

  async close() {
    this.schedules.clear();
    this.idempotency.clear();
    this.history.length = 0;
  }
}

// =============================================================================
// Scheduler
// =============================================================================

export class AirtelWorkflowScheduler {
  constructor({
    workflowRegistry,
    workflowExecutor,
    repository,
    logger,
    metrics,
    tracer,
    audit,
    eventBus,
    clock = () => new Date(),
    scheduleIdFactory,
    leaseTokenFactory,
    config = {},
  } = {}) {
    this.workflowRegistry =
      workflowRegistry;

    this.workflowExecutor =
      workflowExecutor;

    this.repository =
      repository
      || new InMemoryWorkflowSchedulerRepository();

    this.logger =
      logger;

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.audit =
      audit;

    this.eventBus =
      eventBus;

    this.clock =
      clock;

    this.scheduleIdFactory =
      scheduleIdFactory;

    this.leaseTokenFactory =
      leaseTokenFactory;

    const merged = {
      ...DEFAULT_CONFIG,

      ...(isPlainObject(
        config,
      )
        ? config
        : {}),

      provider:
        PROVIDER,
    };

    this.config =
      deepFreeze({
        ...merged,

        retryPolicy:
          deepFreeze({
            ...DEFAULT_RETRY_POLICY,

            ...(isPlainObject(
              config?.retryPolicy,
            )
              ? config.retryPolicy
              : {}),
          }),
      });

    this.statistics = {
      scheduled: 0,
      scheduleFailures: 0,
      claims: 0,
      claimFailures: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      cancellations: 0,
      expirations: 0,
      pauses: 0,
      resumes: 0,
      leaseRenewals: 0,
      leaseConflicts: 0,
    };

    this._closed =
      false;
  }

  // ---------------------------------------------------------------------------
  // Schedule creation
  // ---------------------------------------------------------------------------

  async schedule(
    input = {},
  ) {
    this._assertOpen();

    const context =
      this._normalizeScheduleInput(
        input,
      );

    try {
      const workflow =
        await this._resolveWorkflow(
          context,
        );

      const existing =
        await this._findIdempotentSchedule(
          context,
        );

      if (existing) {
        return this._freeze({
          ...existing,
          replayed: true,
        });
      }

      const scheduleId =
        this._makeScheduleId();

      const createdAt =
        nowIso(this.clock);

      const status =
        context.nextRunAt
          <= createdAt
          ? SCHEDULE_STATUS.READY
          : SCHEDULE_STATUS.SCHEDULED;

      const schedule = {
        component:
          COMPONENT,

        engine:
          ENGINE_NAME,

        engineVersion:
          ENGINE_VERSION,

        schemaVersion:
          SCHEMA_VERSION,

        provider:
          PROVIDER,

        scheduleId,

        tenantId:
          context.tenantId
          || null,

        tenantDigest:
          sha256(
            context.tenantId
            || 'system',
          ),

        scope:
          context.scope,

        workflowId:
          workflow.workflowId,

        workflowVersion:
          workflow.version,

        workflowFingerprint:
          workflow.workflowFingerprint,

        trigger:
          context.trigger,

        executionMode:
          workflow.executionMode,

        requiresApproval:
          workflow.requiresApproval,

        requiresGovernance:
          workflow.requiresGovernance,

        status,

        nextRunAt:
          context.nextRunAt,

        expiresAt:
          context.expiresAt,

        timeoutMs:
          context.timeoutMs,

        leaseMs:
          context.leaseMs,

        attempt:
          0,

        maxAttempts:
          context.retryPolicy
            .maxAttempts,

        retryPolicy:
          context.retryPolicy,

        batchSize:
          context.batchSize,

        correlationId:
          context.correlationId,

        idempotencyKeyDigest:
          context
            .idempotencyKeyDigest,

        requestFingerprint:
          this._requestFingerprint(
            context,
            workflow,
          ),

        workerId:
          null,

        leaseToken:
          null,

        leaseExpiresAt:
          null,

        input:
          context.input,

        metadata:
          context.metadata,

        financialSafety: {
          executionAuthority:
            false,

          paymentPostingAuthority:
            false,

          settlementAuthority:
            false,

          ledgerMutationAuthority:
            false,

          balanceMutationAuthority:
            false,
        },

        createdAt,

        updatedAt:
          createdAt,
      };

      schedule.fingerprint =
        this._scheduleFingerprint(
          schedule,
        );

      this._assertSafeSchedule(
        schedule,
      );

      if (
        this.config
          .persistSchedules
      ) {
        await this._persistSchedule(
          schedule,
        );
      }

      if (
        context.idempotencyKey
      ) {
        await this._saveIdempotency(
          context,
          schedule,
        );
      }

      this.statistics.scheduled += 1;

      this._metric(
        'airtel_workflow_scheduler_scheduled_total',
        1,
        {
          trigger:
            context.trigger,

          status,
        },
      );

      await this._auditEvent(
        'WORKFLOW_SCHEDULED',
        schedule,
      );

      await this._emit(
        'payment.workflow_scheduler.scheduled',
        this._safeEventPayload(
          schedule,
        ),
      );

      return this._freeze({
        ...schedule,
        replayed: false,
      });
    } catch (error) {
      this.statistics
        .scheduleFailures += 1;

      throw error;
    }
  }

  async scheduleWorkflow(
    input = {},
  ) {
    return this.schedule(
      input,
    );
  }

  async createSchedule(
    input = {},
  ) {
    return this.schedule(
      input,
    );
  }

  // ---------------------------------------------------------------------------
  // Due-work discovery / claiming
  // ---------------------------------------------------------------------------

  async listDue({
    tenantId,
    limit =
      this.config.defaultListLimit,
    nowAt,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const boundedLimit =
      normalizeInteger(
        limit,
        this.config
          .defaultListLimit,
        1,
        this.config
          .maxListLimit,
      );

    const dueAt =
      parseDate(nowAt)
      || now(this.clock);

    if (
      typeof this.repository
        ?.findDueSchedules
        === 'function'
    ) {
      const rows =
        await this.repository
          .findDueSchedules({
            tenantId,
            limit:
              boundedLimit,
            nowAt:
              dueAt.toISOString(),
          });

      return this._freeze({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        tenantId,

        tenantDigest:
          sha256(
            tenantId,
          ),

        asOf:
          dueAt.toISOString(),

        count:
          rows.length,

        items:
          rows,
      });
    }

    if (
      typeof this.repository
        ?.listSchedules
        !== 'function'
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .REPOSITORY_REQUIRED,

        'Scheduler repository does not support due-work listing.',

        503,
      );
    }

    const rows =
      await this.repository
        .listSchedules({
          tenantId,

          limit:
            boundedLimit,

          dueBefore:
            dueAt.toISOString(),
        });

    const eligible =
      rows.filter(
        (schedule) =>
          [
            SCHEDULE_STATUS.SCHEDULED,
            SCHEDULE_STATUS.READY,
            SCHEDULE_STATUS.RETRY_PENDING,
          ].includes(
            schedule.status,
          ),
      );

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId,

      tenantDigest:
        sha256(
          tenantId,
        ),

      asOf:
        dueAt.toISOString(),

      count:
        eligible.length,

      items:
        eligible.slice(
          0,
          boundedLimit,
        ),
    });
  }

  async claim({
    tenantId,
    scheduleId,
    workerId,
    leaseMs =
      this.config.defaultLeaseMs,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const normalizedWorker =
      normalizeString(
        workerId,
        160,
      );

    if (
      !normalizedWorker
      || !SAFE_IDENTIFIER_PATTERN.test(
        normalizedWorker,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .WORKER_REQUIRED,

        'A valid workerId is required to claim scheduled work.',

        400,
      );
    }

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    this._assertClaimable(
      schedule,
    );

    const normalizedLeaseMs =
      normalizeInteger(
        leaseMs,
        this.config
          .defaultLeaseMs,
        1_000,
        this.config
          .maxLeaseMs,
      );

    const claimedAt =
      now(this.clock);

    const leaseExpiresAt =
      new Date(
        claimedAt.getTime()
        + normalizedLeaseMs,
      );

    const leaseToken =
      this._makeLeaseToken();

    const update = {
      status:
        SCHEDULE_STATUS.RUNNING,

      workerId:
        normalizedWorker,

      leaseToken,

      leaseExpiresAt:
        leaseExpiresAt
          .toISOString(),

      attempt:
        (
          schedule.attempt
          || 0
        )
        + 1,

      updatedAt:
        claimedAt.toISOString(),

      startedAt:
        schedule.startedAt
        || claimedAt.toISOString(),
    };

    let claimed;

    try {
      claimed =
        await this._updateSchedule({
          tenantId,
          scheduleId,
          update,
          expectedStatus:
            schedule.status,
        });
    } catch (error) {
      this.statistics
        .claimFailures += 1;

      this.statistics
        .leaseConflicts += 1;

      throw error;
    }

    this.statistics.claims += 1;

    await this._auditEvent(
      'WORKFLOW_CLAIMED',
      claimed,
    );

    await this._emit(
      'payment.workflow_scheduler.claimed',
      this._safeEventPayload(
        claimed,
      ),
    );

    return this._freeze({
      ...claimed,

      lease: {
        workerId:
          normalizedWorker,

        leaseToken,

        leaseExpiresAt:
          leaseExpiresAt.toISOString(),
      },
    });
  }

  async claimDue({
    tenantId,
    workerId,
    limit = 1,
    leaseMs =
      this.config.defaultLeaseMs,
    nowAt,
  } = {}) {
    this._assertTenant(
      tenantId,
    );

    const boundedLimit =
      normalizeInteger(
        limit,
        1,
        1,
        this.config
          .maxBatchSize,
      );

    const due =
      await this.listDue({
        tenantId,

        limit:
          boundedLimit * 2,

        nowAt,
      });

    const claimed = [];

    for (
      const item
      of due.items
    ) {
      if (
        claimed.length
        >= boundedLimit
      ) {
        break;
      }

      try {
        const record =
          await this.claim({
            tenantId,
            scheduleId:
              item.scheduleId,
            workerId,
            leaseMs,
          });

        claimed.push(
          record,
        );
      } catch (error) {
        if (
          error?.code
            === ERROR_CODES
              .LEASE_CONFLICT
          || error?.code
            === ERROR_CODES
              .INVALID_TRANSITION
        ) {
          continue;
        }

        throw error;
      }
    }

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId,

      tenantDigest:
        sha256(
          tenantId,
        ),

      count:
        claimed.length,

      items:
        claimed,

      asOf:
        nowIso(
          this.clock,
        ),
    });
  }

  // ---------------------------------------------------------------------------
  // Lease management
  // ---------------------------------------------------------------------------

  async renewLease({
    tenantId,
    scheduleId,
    workerId,
    leaseToken,
    leaseMs =
      this.config.defaultLeaseMs,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    this._assertLease(
      schedule,
      workerId,
      leaseToken,
    );

    const nowAt =
      now(this.clock);

    const currentExpiry =
      parseDate(
        schedule.leaseExpiresAt,
      );

    if (
      !currentExpiry
      || currentExpiry.getTime()
        <= nowAt.getTime()
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .LEASE_EXPIRED,

        'Schedule lease has expired.',

        409,
      );
    }

    const normalizedLeaseMs =
      normalizeInteger(
        leaseMs,
        this.config
          .defaultLeaseMs,
        1_000,
        this.config
          .maxLeaseMs,
      );

    const newExpiry =
      new Date(
        nowAt.getTime()
        + normalizedLeaseMs,
      );

    const updated =
      await this._updateSchedule({
        tenantId,
        scheduleId,

        update: {
          leaseExpiresAt:
            newExpiry.toISOString(),

          updatedAt:
            nowAt.toISOString(),
        },

        expectedStatus:
          SCHEDULE_STATUS.RUNNING,

        expectedLeaseToken:
          leaseToken,
      });

    this.statistics
      .leaseRenewals += 1;

    await this._auditEvent(
      'WORKFLOW_LEASE_RENEWED',
      updated,
    );

    return this._freeze(
      updated,
    );
  }

  // ---------------------------------------------------------------------------
  // Execution acknowledgement — delegates actual workflow execution
  // ---------------------------------------------------------------------------

  async executeClaimed({
    tenantId,
    scheduleId,
    workerId,
    leaseToken,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    this._assertLease(
      schedule,
      workerId,
      leaseToken,
    );

    if (!this.workflowExecutor) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .EXECUTOR_UNAVAILABLE,

        'Workflow executor is not configured.',

        503,
      );
    }

    const method =
      [
        'execute',
        'run',
        'dispatch',
        'process',
      ].find(
        (candidate) =>
          typeof this
            .workflowExecutor?.[
              candidate
            ]
          === 'function',
      );

    if (!method) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .EXECUTOR_UNAVAILABLE,

        'Workflow executor does not expose a supported execution method.',

        503,
      );
    }

    const startedAt =
      Date.now();

    const executionContext = {
      tenantId,

      tenantDigest:
        sha256(
          tenantId,
        ),

      provider:
        PROVIDER,

      scheduleId:
        schedule.scheduleId,

      workflowId:
        schedule.workflowId,

      workflowVersion:
        schedule.workflowVersion,

      workflowFingerprint:
        schedule.workflowFingerprint,

      executionMode:
        schedule.executionMode,

      requiresApproval:
        schedule.requiresApproval,

      requiresGovernance:
        schedule.requiresGovernance,

      trigger:
        schedule.trigger,

      correlationId:
        schedule.correlationId,

      input:
        redact(
          schedule.input,
        ),

      metadata:
        redact(
          schedule.metadata,
        ),

      attempt:
        schedule.attempt,

      dryRun:
        true,

      financialAuthorization:
        false,
    };

    try {
      const result =
        await this._withTimeout(
          this._withSpan(
            `workflow.${method}`,
            () =>
              this
                .workflowExecutor[
                  method
                ](
                  executionContext,
                ),
          ),
          schedule.timeoutMs,
        );

      if (
        safeBytes(result)
        > this.config.maxResultBytes
      ) {
        throw new WorkflowSchedulerError(
          ERROR_CODES
            .EXECUTOR_PROTOCOL_ERROR,

          'Workflow executor result exceeds the configured size limit.',

          502,
        );
      }

      if (
        hasFinancialMutationCapability(
          result,
        )
      ) {
        throw new WorkflowSchedulerError(
          ERROR_CODES
            .EXECUTOR_PROTOCOL_ERROR,

          'Workflow executor result indicates a prohibited financial mutation boundary.',

          502,
        );
      }

      const outcome =
        normalizeString(
          result?.outcome
            || result?.status
            || EXECUTION_OUTCOME.SUCCEEDED,
          40,
        ).toUpperCase();

      if (
        outcome
        === EXECUTION_OUTCOME.RETRY
      ) {
        return this.fail({
          tenantId,
          scheduleId,
          workerId,
          leaseToken,
          retryable:
            true,
          result,
          durationMs:
            Date.now()
            - startedAt,
        });
      }

      if (
        outcome
        === EXECUTION_OUTCOME.FAILED
      ) {
        return this.fail({
          tenantId,
          scheduleId,
          workerId,
          leaseToken,
          retryable:
            false,
          result,
          durationMs:
            Date.now()
            - startedAt,
        });
      }

      if (
        outcome
        === EXECUTION_OUTCOME.CANCELLED
      ) {
        return this.cancel({
          tenantId,
          scheduleId,
          reason:
            'executor-requested-cancellation',
          workerId,
          leaseToken,
        });
      }

      if (
        outcome
        === EXECUTION_OUTCOME.EXPIRED
      ) {
        return this.expire({
          tenantId,
          scheduleId,
          reason:
            'executor-reported-expiration',
          workerId,
          leaseToken,
        });
      }

      return this.complete({
        tenantId,
        scheduleId,
        workerId,
        leaseToken,
        result,
        durationMs:
          Date.now()
          - startedAt,
      });
    } catch (error) {
      return this.fail({
        tenantId,
        scheduleId,
        workerId,
        leaseToken,

        retryable:
          this._isRetryableError(
            error,
          ),

        error,

        durationMs:
          Date.now()
          - startedAt,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle acknowledgements
  // ---------------------------------------------------------------------------

  async complete({
    tenantId,
    scheduleId,
    workerId,
    leaseToken,
    result = null,
    durationMs = null,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    this._assertLease(
      schedule,
      workerId,
      leaseToken,
    );

    if (
      schedule.status
      !== SCHEDULE_STATUS.RUNNING
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Schedule ${scheduleId} is not RUNNING.`,

        409,
      );
    }

    const completedAt =
      nowIso(this.clock);

    const updated =
      await this._updateSchedule({
        tenantId,
        scheduleId,

        update: {
          status:
            SCHEDULE_STATUS.SUCCEEDED,

          completedAt,

          updatedAt:
            completedAt,

          durationMs,

          result:
            redact(result),

          lastError:
            null,

          workerId:
            null,

          leaseToken:
            null,

          leaseExpiresAt:
            null,
        },

        expectedStatus:
          SCHEDULE_STATUS.RUNNING,

        expectedLeaseToken:
          leaseToken,
      });

    this.statistics.successes += 1;

    await this._auditEvent(
      'WORKFLOW_COMPLETED',
      updated,
    );

    await this._emit(
      'payment.workflow_scheduler.completed',
      this._safeEventPayload(
        updated,
      ),
    );

    return this._freeze(
      updated,
    );
  }

  async fail({
    tenantId,
    scheduleId,
    workerId,
    leaseToken,
    retryable = true,
    error = null,
    result = null,
    durationMs = null,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    this._assertLease(
      schedule,
      workerId,
      leaseToken,
    );

    if (
      schedule.status
      !== SCHEDULE_STATUS.RUNNING
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Schedule ${scheduleId} is not RUNNING.`,

        409,
      );
    }

    const attempt =
      Math.max(
        schedule.attempt
          || 1,
        1,
      );

    const nowAt =
      now(this.clock);

    const errorCode =
      maxSeverityCode(
        error,
      );

    const normalizedMessage =
      normalizeString(
        error?.message
          || 'Workflow execution failed.',
        500,
      );

    const attemptsRemaining =
      attempt
      < schedule.maxAttempts;

    const canRetry =
      retryable
      && attemptsRemaining;

    if (canRetry) {
      const delayMs =
        exponentialBackoff(
          schedule.retryPolicy,
          attempt,
        );

      const nextRunAt =
        new Date(
          nowAt.getTime()
          + delayMs,
        );

      if (
        schedule.expiresAt
        && nextRunAt.getTime()
          >= new Date(
            schedule.expiresAt,
          ).getTime()
      ) {
        return this.expire({
          tenantId,
          scheduleId,
          reason:
            'retry-window-expired',
          workerId,
          leaseToken,
        });
      }

      const updated =
        await this._updateSchedule({
          tenantId,
          scheduleId,

          update: {
            status:
              SCHEDULE_STATUS.RETRY_PENDING,

            nextRunAt:
              nextRunAt.toISOString(),

            updatedAt:
              nowAt.toISOString(),

            durationMs,

            result:
              redact(result),

            lastError: {
              code:
                errorCode,

              message:
                normalizedMessage,

              at:
                nowAt.toISOString(),
            },

            workerId:
              null,

            leaseToken:
              null,

            leaseExpiresAt:
              null,
          },

          expectedStatus:
            SCHEDULE_STATUS.RUNNING,

          expectedLeaseToken:
            leaseToken,
        });

      this.statistics.retries += 1;

      await this._auditEvent(
        'WORKFLOW_RETRY_PENDING',
        updated,
      );

      await this._emit(
        'payment.workflow_scheduler.retry_pending',
        this._safeEventPayload(
          updated,
        ),
      );

      return this._freeze(
        updated,
      );
    }

    const finalStatus =
      retryable
        ? SCHEDULE_STATUS.DEAD_LETTERED
        : SCHEDULE_STATUS.FAILED;

    const updated =
      await this._updateSchedule({
        tenantId,
        scheduleId,

        update: {
          status:
            finalStatus,

          failedAt:
            nowAt.toISOString(),

          updatedAt:
            nowAt.toISOString(),

          durationMs,

          result:
            redact(result),

          lastError: {
            code:
              errorCode,

            message:
              normalizedMessage,

            at:
              nowAt.toISOString(),
          },

          workerId:
            null,

          leaseToken:
            null,

          leaseExpiresAt:
            null,
        },

        expectedStatus:
          SCHEDULE_STATUS.RUNNING,

        expectedLeaseToken:
          leaseToken,
      });

    this.statistics.failures += 1;

    if (
      finalStatus
      === SCHEDULE_STATUS.DEAD_LETTERED
    ) {
      this._metric(
        'airtel_workflow_scheduler_dead_lettered_total',
        1,
        {
          workflowId:
            schedule.workflowId,
        },
      );
    }

    await this._auditEvent(
      'WORKFLOW_FAILED',
      updated,
    );

    await this._emit(
      'payment.workflow_scheduler.failed',
      this._safeEventPayload(
        updated,
      ),
    );

    return this._freeze(
      updated,
    );
  }

  async cancel({
    tenantId,
    scheduleId,
    reason = 'cancelled',
    workerId = null,
    leaseToken = null,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    if (
      schedule.status
      === SCHEDULE_STATUS.CANCELLED
    ) {
      return this._freeze(
        schedule,
      );
    }

    if (
      TERMINAL_STATUSES.has(
        schedule.status,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Schedule ${scheduleId} is already terminal.`,

        409,
      );
    }

    if (
      schedule.status
      === SCHEDULE_STATUS.RUNNING
    ) {
      this._assertLease(
        schedule,
        workerId,
        leaseToken,
      );
    }

    if (
      !transitionAllowed(
        schedule.status,
        SCHEDULE_STATUS.CANCELLED,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Schedule ${scheduleId} cannot transition from ${schedule.status} to CANCELLED.`,

        409,
      );
    }

    const updated =
      await this._updateSchedule({
        tenantId,
        scheduleId,

        update: {
          status:
            SCHEDULE_STATUS.CANCELLED,

          cancellationReason:
            normalizeString(
              reason,
              500,
            )
            || 'cancelled',

          cancelledAt:
            nowIso(
              this.clock,
            ),

          updatedAt:
            nowIso(
              this.clock,
            ),

          workerId:
            null,

          leaseToken:
            null,

          leaseExpiresAt:
            null,
        },

        expectedStatus:
          schedule.status,

        expectedLeaseToken:
          schedule.status
          === SCHEDULE_STATUS.RUNNING
            ? leaseToken
            : undefined,
      });

    this.statistics
      .cancellations += 1;

    await this._auditEvent(
      'WORKFLOW_CANCELLED',
      updated,
    );

    await this._emit(
      'payment.workflow_scheduler.cancelled',
      this._safeEventPayload(
        updated,
      ),
    );

    return this._freeze(
      updated,
    );
  }

  async pause({
    tenantId,
    scheduleId,
    reason = 'paused',
  } = {}) {
    return this._setLifecycleStatus({
      tenantId,
      scheduleId,
      targetStatus:
        SCHEDULE_STATUS.PAUSED,
      reason,
    });
  }

  async resume({
    tenantId,
    scheduleId,
    reason = 'resumed',
  } = {}) {
    return this._setLifecycleStatus({
      tenantId,
      scheduleId,
      targetStatus:
        SCHEDULE_STATUS.READY,
      reason,
    });
  }

  async expire({
    tenantId,
    scheduleId,
    reason = 'expired',
    workerId = null,
    leaseToken = null,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    if (
      schedule.status
      === SCHEDULE_STATUS.EXPIRED
    ) {
      return this._freeze(
        schedule,
      );
    }

    if (
      schedule.status
      === SCHEDULE_STATUS.RUNNING
    ) {
      this._assertLease(
        schedule,
        workerId,
        leaseToken,
      );
    }

    if (
      !transitionAllowed(
        schedule.status,
        SCHEDULE_STATUS.EXPIRED,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Schedule ${scheduleId} cannot transition from ${schedule.status} to EXPIRED.`,

        409,
      );
    }

    const updated =
      await this._updateSchedule({
        tenantId,
        scheduleId,

        update: {
          status:
            SCHEDULE_STATUS.EXPIRED,

          expirationReason:
            normalizeString(
              reason,
              500,
            )
            || 'expired',

          expiredAt:
            nowIso(
              this.clock,
            ),

          updatedAt:
            nowIso(
              this.clock,
            ),

          workerId:
            null,

          leaseToken:
            null,

          leaseExpiresAt:
            null,
        },

        expectedStatus:
          schedule.status,

        expectedLeaseToken:
          schedule.status
          === SCHEDULE_STATUS.RUNNING
            ? leaseToken
            : undefined,
      });

    this.statistics
      .expirations += 1;

    await this._auditEvent(
      'WORKFLOW_EXPIRED',
      updated,
    );

    await this._emit(
      'payment.workflow_scheduler.expired',
      this._safeEventPayload(
        updated,
      ),
    );

    return this._freeze(
      updated,
    );
  }

  async reschedule({
    tenantId,
    scheduleId,
    nextRunAt,
    reason = 'rescheduled',
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    if (
      TERMINAL_STATUSES.has(
        schedule.status,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Terminal schedule ${scheduleId} cannot be rescheduled.`,

        409,
      );
    }

    const next =
      parseDate(
        nextRunAt,
      );

    if (!next) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.INVALID_INPUT,
        'A valid nextRunAt timestamp is required.',
        400,
      );
    }

    this._assertScheduleTimeBounds(
      next,
      schedule.expiresAt,
    );

    const status =
      next.getTime()
      <= now(this.clock).getTime()
        ? SCHEDULE_STATUS.READY
        : SCHEDULE_STATUS.SCHEDULED;

    const updated =
      await this._updateSchedule({
        tenantId,
        scheduleId,

        update: {
          status,

          nextRunAt:
            next.toISOString(),

          rescheduleReason:
            normalizeString(
              reason,
              500,
            )
            || 'rescheduled',

          rescheduledAt:
            nowIso(
              this.clock,
            ),

          updatedAt:
            nowIso(
              this.clock,
            ),
        },

        expectedStatus:
          schedule.status,
      });

    await this._auditEvent(
      'WORKFLOW_RESCHEDULED',
      updated,
    );

    await this._emit(
      'payment.workflow_scheduler.rescheduled',
      this._safeEventPayload(
        updated,
      ),
    );

    return this._freeze(
      updated,
    );
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async get({
    tenantId,
    scheduleId,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    return this._freeze(
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      }),
    );
  }

  async getSchedule(
    input = {},
  ) {
    return this.get(
      input,
    );
  }

  async list({
    tenantId,
    status,
    workflowId,
    limit =
      this.config.defaultListLimit,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const boundedLimit =
      normalizeInteger(
        limit,
        this.config
          .defaultListLimit,
        1,
        this.config
          .maxListLimit,
      );

    if (status) {
      const normalizedStatus =
        normalizeString(
          status,
          50,
        ).toUpperCase();

      if (
        !VALID_STATUS_SET.has(
          normalizedStatus,
        )
      ) {
        throw new WorkflowSchedulerError(
          ERROR_CODES.INVALID_INPUT,

          `Unsupported schedule status ${normalizedStatus}.`,

          400,
        );
      }

      status =
        normalizedStatus;
    }

    if (workflowId) {
      workflowId =
        normalizeString(
          workflowId,
          200,
        );
    }

    if (
      typeof this.repository
        ?.listSchedules
        !== 'function'
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .REPOSITORY_REQUIRED,

        'Scheduler repository does not support list operations.',

        503,
      );
    }

    let items =
      await this.repository
        .listSchedules({
          tenantId,
          status,
          limit:
            boundedLimit,
        });

    if (workflowId) {
      items =
        items.filter(
          (item) =>
            item.workflowId
            === workflowId,
        );
    }

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId,

      tenantDigest:
        sha256(
          tenantId,
        ),

      count:
        items.length,

      items:
        items.slice(
          0,
          boundedLimit,
        ),

      generatedAt:
        nowIso(
          this.clock,
        ),
    });
  }

  async getStatus({
    tenantId,
  } = {}) {
    const counts =
      await this._statusCounts(
        tenantId,
      );

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId,

      tenantDigest:
        sha256(
          tenantId
          || 'system',
        ),

      statusCounts:
        counts,

      generatedAt:
        nowIso(
          this.clock,
        ),

      statistics: {
        ...this.statistics,
      },
    });
  }

  async getOverview({
    tenantId,
  } = {}) {
    const status =
      await this.getStatus({
        tenantId,
      });

    const due =
      await this.listDue({
        tenantId,

        limit:
          Math.min(
            this.config
              .maxBatchSize,
            20,
          ),
      });

    return this._freeze({
      ...status,

      dueCount:
        due.count,

      dueItems:
        due.items,

      activeCount:
        Object.entries(
          status.statusCounts,
        )
          .filter(
            ([key]) =>
              ACTIVE_STATUSES.has(
                key,
              ),
          )
          .reduce(
            (
              sum,
              [, value],
            ) =>
              sum + value,
            0,
          ),
    });
  }

  async getSummary({
    tenantId,
  } = {}) {
    const overview =
      await this.getOverview({
        tenantId,
      });

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId,

      tenantDigest:
        sha256(
          tenantId
          || 'system',
        ),

      statusCounts:
        overview.statusCounts,

      dueCount:
        overview.dueCount,

      activeCount:
        overview.activeCount,

      statistics:
        overview.statistics,

      generatedAt:
        overview.generatedAt,
    });
  }

  async getHistory({
    tenantId,
    limit =
      this.config.defaultListLimit,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const boundedLimit =
      normalizeInteger(
        limit,
        this.config
          .defaultListLimit,
        1,
        this.config
          .maxHistory,
      );

    if (
      typeof this.repository
        ?.historyList
        !== 'function'
    ) {
      return this._freeze({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        tenantId,

        tenantDigest:
          sha256(
            tenantId,
          ),

        count:
          0,

        records:
          [],

        generatedAt:
          nowIso(
            this.clock,
          ),
      });
    }

    const records =
      await this.repository
        .historyList({
          tenantId,
          limit:
            boundedLimit,
        });

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId,

      tenantDigest:
        sha256(
          tenantId,
        ),

      count:
        records.length,

      records,

      generatedAt:
        nowIso(
          this.clock,
        ),
    });
  }

  async exportOverview({
    tenantId,
  } = {}) {
    const result =
      await this.getOverview({
        tenantId,
      });

    const payload =
      JSON.stringify(
        result,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        payload,
        'utf8',
      );

    if (
      bytes
      > this.config
        .maxExportBytes
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .EXPORT_TOO_LARGE,

        'Workflow scheduler export exceeds the configured size limit.',

        413,
      );
    }

    return this._freeze({
      contentType:
        'application/json',

      filename:
        'airtel-workflow-scheduler-overview.json',

      bytes,

      fingerprint:
        sha256(result),

      payload,
    });
  }

  // ---------------------------------------------------------------------------
  // Operational lifecycle / maintenance helpers
  // ---------------------------------------------------------------------------

  async processExpired({
    tenantId,
    limit =
      this.config.maxBatchSize,
    nowAt,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const nowTime =
      parseDate(nowAt)
      || now(this.clock);

    const due =
      await this.listDue({
        tenantId,
        limit,
        nowAt:
          nowTime.toISOString(),
      });

    const expired = [];

    for (
      const schedule
      of due.items
    ) {
      const expiresAt =
        parseDate(
          schedule.expiresAt,
        );

      if (
        !expiresAt
        || expiresAt.getTime()
          > nowTime.getTime()
      ) {
        continue;
      }

      try {
        expired.push(
          await this.expire({
            tenantId,

            scheduleId:
              schedule.scheduleId,

            reason:
              'schedule-expiry-window-reached',
          }),
        );
      } catch (error) {
        if (
          error?.code
          !== ERROR_CODES
            .INVALID_TRANSITION
        ) {
          throw error;
        }
      }
    }

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId,

      count:
        expired.length,

      items:
        expired,

      processedAt:
        nowIso(
          this.clock,
        ),
    });
  }

  async recoverExpiredLeases({
    tenantId,
    limit =
      this.config.maxBatchSize,
    nowAt,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const nowTime =
      parseDate(nowAt)
      || now(this.clock);

    if (
      typeof this.repository
        ?.listSchedules
        !== 'function'
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .REPOSITORY_REQUIRED,

        'Scheduler repository does not support lease recovery.',

        503,
      );
    }

    const running =
      await this.repository
        .listSchedules({
          tenantId,

          status:
            SCHEDULE_STATUS.RUNNING,

          limit:
            normalizeInteger(
              limit,
              this.config
                .maxBatchSize,
              1,
              this.config
                .maxBatchSize,
            ),
        });

    const recovered = [];

    for (
      const schedule
      of running
    ) {
      const leaseExpiresAt =
        parseDate(
          schedule
            .leaseExpiresAt,
        );

      if (
        !leaseExpiresAt
        || leaseExpiresAt
            .getTime()
          > nowTime.getTime()
      ) {
        continue;
      }

      const retryAvailable =
        (
          schedule.attempt
          || 1
        )
        < schedule.maxAttempts;

      try {
        if (retryAvailable) {
          const delayMs =
            exponentialBackoff(
              schedule.retryPolicy,
              schedule.attempt
                || 1,
            );

          const nextRunAt =
            new Date(
              nowTime.getTime()
              + delayMs,
            );

          const updated =
            await this._updateSchedule({
              tenantId,

              scheduleId:
                schedule.scheduleId,

              update: {
                status:
                  SCHEDULE_STATUS
                    .RETRY_PENDING,

                nextRunAt:
                  nextRunAt
                    .toISOString(),

                updatedAt:
                  nowTime.toISOString(),

                lastError: {
                  code:
                    ERROR_CODES
                      .LEASE_EXPIRED,

                  message:
                    'Worker lease expired before acknowledgement.',

                  at:
                    nowTime.toISOString(),
                },

                workerId:
                  null,

                leaseToken:
                  null,

                leaseExpiresAt:
                  null,
              },

              expectedStatus:
                SCHEDULE_STATUS.RUNNING,
            });

          recovered.push(
            updated,
          );

          this.statistics
            .retries += 1;
        } else {
          const updated =
            await this._updateSchedule({
              tenantId,

              scheduleId:
                schedule.scheduleId,

              update: {
                status:
                  SCHEDULE_STATUS
                    .DEAD_LETTERED,

                updatedAt:
                  nowTime.toISOString(),

                lastError: {
                  code:
                    ERROR_CODES
                      .LEASE_EXPIRED,

                  message:
                    'Worker lease expired and retry budget was exhausted.',

                  at:
                    nowTime.toISOString(),
                },

                workerId:
                  null,

                leaseToken:
                  null,

                leaseExpiresAt:
                  null,
              },

              expectedStatus:
                SCHEDULE_STATUS.RUNNING,
            });

          recovered.push(
            updated,
          );

          this.statistics
            .failures += 1;
        }
      } catch (error) {
        if (
          error?.code
          !== ERROR_CODES
            .INVALID_TRANSITION
        ) {
          throw error;
        }
      }
    }

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId,

      count:
        recovered.length,

      items:
        recovered,

      processedAt:
        nowIso(
          this.clock,
        ),
    });
  }

  // ---------------------------------------------------------------------------
  // Context / validation
  // ---------------------------------------------------------------------------

  _normalizeScheduleInput(
    input,
  ) {
    if (!isPlainObject(input)) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.INVALID_INPUT,
        'Schedule input must be a plain object.',
        400,
      );
    }

    if (
      safeBytes(input)
      > this.config
        .maxPayloadBytes
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .PAYLOAD_TOO_LARGE,

        'Schedule input exceeds the configured payload limit.',

        413,
      );
    }

    const provider =
      normalizeProvider(
        input.provider
          || PROVIDER,
      );

    if (
      provider
      !== PROVIDER
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .PROVIDER_SCOPE_VIOLATION,

        'This scheduler is restricted to Airtel.',

        403,

        {
          provider,
        },
      );
    }

    const tenantId =
      normalizeTenantId(
        input.tenantId,
      );

    const scope =
      normalizeString(
        input.scope,
        20,
      ).toUpperCase()
      || SCHEDULE_SCOPE.TENANT;

    if (
      !VALID_SCOPE_SET.has(
        scope,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.INVALID_INPUT,

        `Unsupported schedule scope ${scope}.`,

        400,
      );
    }

    if (
      scope
      === SCHEDULE_SCOPE.SYSTEM
      && !this.config
        .systemScopeAllowed
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .SYSTEM_SCOPE_FORBIDDEN,

        'System scope is disabled for workflow scheduling.',

        403,
      );
    }

    this._assertTenant(
      tenantId,
      scope,
    );

    const workflowId =
      normalizeString(
        input.workflowId
        || input.workflow?.workflowId
        || input.workflow?.id,
        200,
      ).toLowerCase();

    if (!workflowId) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .WORKFLOW_REQUIRED,

        'workflowId is required.',

        400,
      );
    }

    if (
      !SAFE_IDENTIFIER_PATTERN.test(
        workflowId,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .WORKFLOW_REQUIRED,

        'workflowId contains unsupported characters.',

        400,
      );
    }

    const workflowVersion =
      input.version
      || input.workflowVersion
      || input.workflow?.version
      || null;

    const trigger =
      normalizeString(
        input.trigger
          || SCHEDULE_TRIGGER.MANUAL,
        40,
      ).toUpperCase();

    if (
      !VALID_TRIGGER_SET.has(
        trigger,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.INVALID_INPUT,

        `Unsupported schedule trigger ${trigger}.`,

        400,
      );
    }

    const nowAt =
      now(this.clock);

    const nextRun =
      parseDate(
        input.nextRunAt,
      )
      || new Date(
        nowAt.getTime()
        + normalizeInteger(
          input.delayMs,
          this.config
            .defaultDelayMs,
          0,
          this.config
            .maxScheduleAheadMs,
        ),
      );

    this._assertScheduleTimeBounds(
      nextRun,
    );

    const expiresAt =
      input.expiresAt
        ? parseDate(
            input.expiresAt,
          )
        : new Date(
            Math.min(
              nextRun.getTime()
                + this.config
                    .defaultExecutionWindowMs,

              nowAt.getTime()
                + this.config
                    .maxScheduleAheadMs,
            ),
          );

    if (
      !expiresAt
      || expiresAt.getTime()
        <= nextRun.getTime()
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .SCHEDULE_INVALID,

        'expiresAt must be later than nextRunAt.',

        400,
      );
    }

    const timeoutMs =
      normalizeInteger(
        input.timeoutMs,
        this.config
          .defaultTimeoutMs,
        100,
        this.config
          .maxTimeoutMs,
      );

    const leaseMs =
      normalizeInteger(
        input.leaseMs,
        this.config
          .defaultLeaseMs,
        1_000,
        this.config
          .maxLeaseMs,
      );

    const batchSize =
      normalizeInteger(
        input.batchSize,
        1,
        1,
        this.config
          .maxBatchSize,
      );

    const retryPolicy =
      this._normalizeRetryPolicy(
        input.retryPolicy,
      );

    const idempotencyKeyValue =
      normalizeString(
        input.idempotencyKey,
        200,
      );

    if (
      this.config
        .requireIdempotencyForSchedule
      && !idempotencyKeyValue
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .IDEMPOTENCY_REQUIRED,

        'A schedule idempotencyKey is required.',

        400,
      );
    }

    const metadata =
      this._normalizeMetadata(
        input.metadata,
      );

    const scheduleInput =
      redact(
        input.input
        ?? input.payload
        ?? {},
      );

    if (
      safeBytes(
        scheduleInput,
      )
      > this.config
        .maxPayloadBytes
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .PAYLOAD_TOO_LARGE,

        'Workflow input exceeds the configured payload limit.',

        413,
      );
    }

    return {
      provider:
        PROVIDER,

      tenantId,

      scope,

      workflowId,

      workflowVersion,

      trigger,

      nextRunAt:
        nextRun.toISOString(),

      expiresAt:
        expiresAt.toISOString(),

      timeoutMs,

      leaseMs,

      batchSize,

      retryPolicy,

      correlationId:
        normalizeString(
          input.correlationId,
          160,
        )
        || crypto.randomUUID(),

      idempotencyKey:
        idempotencyKeyValue,

      idempotencyKeyDigest:
        idempotencyKeyValue
          ? sha256(
              idempotencyKeyValue,
            )
          : null,

      input:
        scheduleInput,

      metadata,

      requestedBy:
        redact(
          input.requestedBy
          ?? input.actor
          ?? null,
        ),

      dryRun:
        input.dryRun
        !== false,
    };
  }

  _normalizeRetryPolicy(
    policy,
  ) {
    if (
      policy == null
    ) {
      return {
        ...this.config
          .retryPolicy,
      };
    }

    if (
      !isPlainObject(
        policy,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.INVALID_INPUT,

        'retryPolicy must be an object.',

        400,
      );
    }

    return {
      maxAttempts:
        normalizeInteger(
          policy.maxAttempts,
          this.config
            .retryPolicy
            .maxAttempts,
          1,
          this.config
            .maxAttempts,
        ),

      initialDelayMs:
        normalizeInteger(
          policy.initialDelayMs,
          this.config
            .retryPolicy
            .initialDelayMs,
          0,
          this.config
            .retryPolicy
            .maxDelayMs,
        ),

      maxDelayMs:
        normalizeInteger(
          policy.maxDelayMs,
          this.config
            .retryPolicy
            .maxDelayMs,
          0,
          this.config
            .retryPolicy
            .maxDelayMs,
        ),

      multiplier:
        Math.min(
          Math.max(
            normalizeNumber(
              policy.multiplier,
              this.config
                .retryPolicy
                .multiplier,
            ),
            1,
          ),
          10,
        ),
    };
  }

  _normalizeMetadata(
    metadata,
  ) {
    if (
      !isPlainObject(
        metadata,
      )
    ) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(
        metadata,
      )
        .slice(
          0,
          this.config
            .maxMetadataKeys,
        )
        .map(
          ([key, value]) => [
            normalizeString(
              key,
              100,
            ),

            redact(
              value,
            ),
          ],
        )
        .filter(
          ([key]) =>
            Boolean(key),
        ),
    );
  }

  _assertTenant(
    tenantId,
    scope =
      SCHEDULE_SCOPE.TENANT,
  ) {
    const normalized =
      normalizeTenantId(
        tenantId,
      );

    if (
      this.config.tenantRequired
      && scope
        !== SCHEDULE_SCOPE.SYSTEM
      && !normalized
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .TENANT_REQUIRED,

        'tenantId is required.',

        400,
      );
    }

    if (
      normalized
      && normalized.length < 2
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .TENANT_INVALID,

        'tenantId is invalid.',

        400,
      );
    }
  }

  _assertScheduleTimeBounds(
    nextRun,
    expiresAt = null,
  ) {
    if (
      !nextRun
      || Number.isNaN(
        nextRun.getTime(),
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .SCHEDULE_INVALID,

        'A valid nextRunAt timestamp is required.',

        400,
      );
    }

    const nowTime =
      now(this.clock).getTime();

    if (
      nextRun.getTime()
      > nowTime
        + this.config
            .maxScheduleAheadMs
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .SCHEDULE_INVALID,

        'nextRunAt is beyond the configured scheduling horizon.',

        400,
      );
    }

    if (
      expiresAt
    ) {
      const expiry =
        parseDate(
          expiresAt,
        );

      if (
        !expiry
        || expiry.getTime()
          <= nextRun.getTime()
      ) {
        throw new WorkflowSchedulerError(
          ERROR_CODES
            .SCHEDULE_INVALID,

          'expiresAt must be later than nextRunAt.',

          400,
        );
      }
    }
  }

  async _resolveWorkflow(
    context,
  ) {
    if (
      !this.workflowRegistry
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .WORKFLOW_NOT_FOUND,

        'Workflow registry is not configured.',

        503,
      );
    }

    const method =
      [
        'resolve',
        'resolveWorkflow',
      ].find(
        (candidate) =>
          typeof this
            .workflowRegistry?.[
              candidate
            ]
          === 'function',
      );

    if (!method) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .WORKFLOW_NOT_FOUND,

        'Workflow registry does not expose a supported resolution method.',

        503,
      );
    }

    const result =
      await this
        .workflowRegistry[
          method
        ]({
          tenantId:
            context.tenantId,

          workflowId:
            context.workflowId,

          version:
            context
              .workflowVersion
            || undefined,

          trigger:
            context.trigger,

          executionMode:
            undefined,
        });

    if (
      !result?.workflowId
      || !result?.version
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .WORKFLOW_NOT_FOUND,

        'Workflow registry returned an invalid workflow resolution.',

        502,
      );
    }

    const provider =
      normalizeProvider(
        result.provider
        || PROVIDER,
      );

    if (
      provider !== PROVIDER
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .PROVIDER_SCOPE_VIOLATION,

        'Workflow registry returned a non-Airtel workflow.',

        502,
      );
    }

    return {
      workflowId:
        normalizeString(
          result.workflowId,
          200,
        ).toLowerCase(),

      version:
        normalizeString(
          result.version,
          80,
        ),

      provider:
        PROVIDER,

      executionMode:
        normalizeString(
          result.executionMode,
          50,
        ).toUpperCase()
        || 'ADVISORY',

      requiresApproval:
        result.requiresApproval
        === true,

      requiresGovernance:
        result.requiresGovernance
        === true,

      workflowFingerprint:
        normalizeString(
          result.workflowFingerprint,
          160,
        )
        || null,
    };
  }

  _assertSafeSchedule(
    schedule,
  ) {
    if (
      hasFinancialMutationCapability(
        schedule,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .SCHEDULE_INVALID,

        'Schedule definition contains a prohibited financial mutation capability.',

        403,
      );
    }
  }

  _assertClaimable(
    schedule,
  ) {
    const currentStatus =
      schedule.status;

    if (
      ![
        SCHEDULE_STATUS.SCHEDULED,
        SCHEDULE_STATUS.READY,
        SCHEDULE_STATUS.RETRY_PENDING,
      ].includes(
        currentStatus,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Schedule ${schedule.scheduleId} is not claimable from ${currentStatus}.`,

        409,
      );
    }

    const nowTime =
      now(this.clock).getTime();

    const nextRunTime =
      new Date(
        schedule.nextRunAt,
      ).getTime();

    if (
      Number.isFinite(
        nextRunTime,
      )
      && nextRunTime
        > nowTime
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        'Schedule is not due yet.',

        409,
      );
    }

    if (
      schedule.expiresAt
    ) {
      const expiryTime =
        new Date(
          schedule.expiresAt,
        ).getTime();

      if (
        Number.isFinite(
          expiryTime,
        )
        && expiryTime
          <= nowTime
      ) {
        throw new WorkflowSchedulerError(
          ERROR_CODES
            .INVALID_TRANSITION,

          'Schedule has expired.',

          409,
        );
      }
    }
  }

  _assertLease(
    schedule,
    workerId,
    leaseToken,
  ) {
    const normalizedWorker =
      normalizeString(
        workerId,
        160,
      );

    const normalizedToken =
      normalizeString(
        leaseToken,
        240,
      );

    if (
      !normalizedWorker
      || !normalizedToken
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.LEASE_INVALID,

        'workerId and leaseToken are required.',

        400,
      );
    }

    if (
      schedule.workerId
        !== normalizedWorker
      || schedule.leaseToken
        !== normalizedToken
    ) {
      this.statistics
        .leaseConflicts += 1;

      throw new WorkflowSchedulerError(
        ERROR_CODES.LEASE_CONFLICT,

        'Worker lease does not match the scheduled task.',

        409,
      );
    }

    const expiry =
      parseDate(
        schedule.leaseExpiresAt,
      );

    if (
      !expiry
      || expiry.getTime()
        <= now(this.clock)
          .getTime()
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.LEASE_EXPIRED,

        'Worker lease has expired.',

        409,
      );
    }
  }

  async _findIdempotentSchedule(
    context,
  ) {
    if (
      !context.idempotencyKey
    ) {
      return null;
    }

    if (
      typeof this.repository
        ?.getByIdempotency
        !== 'function'
    ) {
      return null;
    }

    const existing =
      await this.repository
        .getByIdempotency({
          tenantId:
            context.tenantId,

          provider:
            PROVIDER,

          idempotencyKey:
            context.idempotencyKey,
        });

    if (!existing) {
      return null;
    }

    const fingerprint =
      this._requestFingerprintFromInput(
        context,
      );

    if (
      existing.fingerprint
      && existing.fingerprint
        !== fingerprint
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .IDEMPOTENCY_CONFLICT,

        'The schedule idempotency key was reused for a different request.',

        409,
      );
    }

    return existing.schedule;
  }

  _requestFingerprintFromInput(
    context,
  ) {
    return sha256({
      provider:
        PROVIDER,

      tenantDigest:
        sha256(
          context.tenantId
          || 'system',
        ),

      scope:
        context.scope,

      workflowId:
        context.workflowId,

      workflowVersion:
        context.workflowVersion
        || null,

      trigger:
        context.trigger,

      nextRunAt:
        context.nextRunAt,

      expiresAt:
        context.expiresAt,

      timeoutMs:
        context.timeoutMs,

      leaseMs:
        context.leaseMs,

      batchSize:
        context.batchSize,

      retryPolicy:
        context.retryPolicy,

      input:
        context.input,

      metadata:
        context.metadata,

      dryRun:
        context.dryRun,
    });
  }

  _requestFingerprint(
    context,
    workflow,
  ) {
    return sha256({
      ...this._requestFingerprintFromInput(
        context,
      ),

      resolvedWorkflowId:
        workflow.workflowId,

      resolvedWorkflowVersion:
        workflow.version,

      workflowFingerprint:
        workflow.workflowFingerprint,
    });
  }

  _scheduleFingerprint(
    schedule,
  ) {
    return sha256({
      provider:
        PROVIDER,

      tenantDigest:
        schedule.tenantDigest,

      scope:
        schedule.scope,

      scheduleId:
        schedule.scheduleId,

      workflowId:
        schedule.workflowId,

      workflowVersion:
        schedule.workflowVersion,

      workflowFingerprint:
        schedule.workflowFingerprint,

      trigger:
        schedule.trigger,

      executionMode:
        schedule.executionMode,

      requiresApproval:
        schedule.requiresApproval,

      requiresGovernance:
        schedule.requiresGovernance,

      nextRunAt:
        schedule.nextRunAt,

      expiresAt:
        schedule.expiresAt,

      timeoutMs:
        schedule.timeoutMs,

      leaseMs:
        schedule.leaseMs,

      maxAttempts:
        schedule.maxAttempts,

      retryPolicy:
        schedule.retryPolicy,

      batchSize:
        schedule.batchSize,

      requestFingerprint:
        schedule.requestFingerprint,

      input:
        schedule.input,

      metadata:
        schedule.metadata,
    });
  }

  _makeScheduleId() {
    if (
      typeof this
        .scheduleIdFactory
      === 'function'
    ) {
      const generated =
        normalizeString(
          this.scheduleIdFactory(),
          200,
        );

      if (generated) {
        return generated;
      }
    }

    return crypto.randomUUID();
  }

  _makeLeaseToken() {
    if (
      typeof this
        .leaseTokenFactory
      === 'function'
    ) {
      const generated =
        normalizeString(
          this.leaseTokenFactory(),
          240,
        );

      if (generated) {
        return generated;
      }
    }

    return crypto
      .randomBytes(32)
      .toString('hex');
  }

  async _getScheduleOrThrow({
    tenantId,
    scheduleId,
  }) {
    const normalizedId =
      normalizeString(
        scheduleId,
        200,
      );

    if (!normalizedId) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .SCHEDULE_INVALID,

        'scheduleId is required.',

        400,
      );
    }

    if (
      typeof this.repository
        ?.getSchedule
        !== 'function'
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .REPOSITORY_REQUIRED,

        'Scheduler repository does not support get operations.',

        503,
      );
    }

    const schedule =
      await this.repository
        .getSchedule({
          tenantId,

          scheduleId:
            normalizedId,
        });

    if (!schedule) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .SCHEDULE_NOT_FOUND,

        `Schedule ${normalizedId} was not found.`,

        404,
      );
    }

    if (
      normalizeProvider(
        schedule.provider
        || PROVIDER,
      )
      !== PROVIDER
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .PROVIDER_SCOPE_VIOLATION,

        'Stored schedule is outside the Airtel provider boundary.',

        500,
      );
    }

    if (
      tenantId
      && normalizeTenantId(
        schedule.tenantId,
      )
      && normalizeTenantId(
        schedule.tenantId,
      )
      !== normalizeTenantId(
        tenantId,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .SCHEDULE_INVALID,

        'Stored schedule violates tenant isolation.',

        500,
      );
    }

    return schedule;
  }

  async _updateSchedule({
    tenantId,
    scheduleId,
    update,
    expectedStatus,
    expectedLeaseToken,
  }) {
    if (
      typeof this.repository
        ?.updateSchedule
        !== 'function'
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .REPOSITORY_REQUIRED,

        'Scheduler repository does not support update operations.',

        503,
      );
    }

    if (
      update?.status
      && expectedStatus
      && !transitionAllowed(
        expectedStatus,
        update.status,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Transition ${expectedStatus} -> ${update.status} is not allowed.`,

        409,
      );
    }

    try {
      const updated =
        await this.repository
          .updateSchedule({
            tenantId,

            scheduleId,

            update:
              redact(
                update,
              ),

            expectedStatus,

            expectedLeaseToken,
          });

      if (!updated) {
        throw new WorkflowSchedulerError(
          ERROR_CODES
            .SCHEDULE_NOT_FOUND,

          `Schedule ${scheduleId} was not found.`,

          404,
        );
      }

      return updated;
    } catch (error) {
      if (
        error
        instanceof WorkflowSchedulerError
      ) {
        throw error;
      }

      throw new WorkflowSchedulerError(
        ERROR_CODES
          .PERSISTENCE_FAILED,

        'Workflow schedule persistence failed.',

        503,

        undefined,

        error,
      );
    }
  }

  async _persistSchedule(
    schedule,
  ) {
    if (
      typeof this.repository
        ?.createSchedule
        !== 'function'
    ) {
      if (
        this.config
          .requireRepository
      ) {
        throw new WorkflowSchedulerError(
          ERROR_CODES
            .REPOSITORY_REQUIRED,

          'A durable scheduler repository is required.',

          503,
        );
      }

      return;
    }

    try {
      await this.repository
        .createSchedule(
          redact(schedule),
        );
    } catch (error) {
      if (
        error
        instanceof WorkflowSchedulerError
      ) {
        throw error;
      }

      if (
        this.config
          .failClosedOnPersistenceError
      ) {
        throw new WorkflowSchedulerError(
          ERROR_CODES
            .PERSISTENCE_FAILED,

          'Workflow schedule persistence failed.',

          503,

          undefined,

          error,
        );
      }
    }
  }

  async _saveIdempotency(
    context,
    schedule,
  ) {
    if (
      typeof this.repository
        ?.saveIdempotency
        !== 'function'
    ) {
      return;
    }

    try {
      await this.repository
        .saveIdempotency({
          tenantId:
            context.tenantId,

          provider:
            PROVIDER,

          idempotencyKey:
            context.idempotencyKey,

          fingerprint:
            this._requestFingerprintFromInput(
              context,
            ),

          schedule,
        });
    } catch (error) {
      if (
        this.config
          .failClosedOnPersistenceError
      ) {
        throw new WorkflowSchedulerError(
          ERROR_CODES
            .PERSISTENCE_FAILED,

          'Workflow schedule idempotency persistence failed.',

          503,

          undefined,

          error,
        );
      }
    }
  }

  async _setLifecycleStatus({
    tenantId,
    scheduleId,
    targetStatus,
    reason,
  }) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const schedule =
      await this._getScheduleOrThrow({
        tenantId,
        scheduleId,
      });

    if (
      !transitionAllowed(
        schedule.status,
        targetStatus,
      )
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .INVALID_TRANSITION,

        `Schedule ${scheduleId} cannot transition from ${schedule.status} to ${targetStatus}.`,

        409,
      );
    }

    const updated =
      await this._updateSchedule({
        tenantId,
        scheduleId,

        update: {
          status:
            targetStatus,

          lifecycleReason:
            normalizeString(
              reason,
              500,
            )
            || targetStatus
              .toLowerCase(),

          updatedAt:
            nowIso(
              this.clock,
            ),

          workerId:
            null,

          leaseToken:
            null,

          leaseExpiresAt:
            null,
        },

        expectedStatus:
          schedule.status,
      });

    if (
      targetStatus
      === SCHEDULE_STATUS.PAUSED
    ) {
      this.statistics
        .pauses += 1;
    }

    if (
      targetStatus
      === SCHEDULE_STATUS.READY
    ) {
      this.statistics
        .resumes += 1;
    }

    await this._auditEvent(
      targetStatus
        === SCHEDULE_STATUS.PAUSED
        ? 'WORKFLOW_PAUSED'
        : 'WORKFLOW_RESUMED',
      updated,
    );

    return this._freeze(
      updated,
    );
  }

  async _statusCounts(
    tenantId,
  ) {
    if (
      typeof this.repository
        ?.countByStatus
        === 'function'
    ) {
      return this.repository
        .countByStatus({
          tenantId,
        });
    }

    if (
      typeof this.repository
        ?.listSchedules
        !== 'function'
    ) {
      throw new WorkflowSchedulerError(
        ERROR_CODES
          .REPOSITORY_REQUIRED,

        'Scheduler repository does not support status aggregation.',

        503,
      );
    }

    const rows =
      await this.repository
        .listSchedules({
          tenantId,

          limit:
            this.config
              .maxHistory,
        });

    const counts = {};

    for (
      const status
      of VALID_STATUS_SET
    ) {
      counts[status] = 0;
    }

    for (
      const row
      of rows
    ) {
      counts[row.status] =
        (
          counts[row.status]
          || 0
        )
        + 1;
    }

    return counts;
  }

  _isRetryableError(
    error,
  ) {
    if (!error) {
      return true;
    }

    const code =
      String(
        error.code || '',
      ).toUpperCase();

    if (
      code.includes('AUTH')
      || code.includes(
        'PERMISSION',
      )
      || code.includes(
        'INVALID',
      )
      || code.includes(
        'PROVIDER_SCOPE',
      )
      || code.includes(
        'CAPABILITY_FORBIDDEN',
      )
    ) {
      return false;
    }

    return true;
  }

  async _withTimeout(
    promise,
    timeoutMs,
  ) {
    let timer = null;

    const timeout =
      new Promise(
        (_, reject) => {
          timer =
            setTimeout(
              () => {
                reject(
                  new WorkflowSchedulerError(
                    ERROR_CODES.TIMEOUT,

                    'Workflow execution timed out.',

                    504,
                  ),
                );
              },
              timeoutMs,
            );

          timer.unref?.();
        },
      );

    try {
      return await Promise.race([
        Promise.resolve(
          promise,
        ),

        timeout,
      ]);
    } finally {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  async _withSpan(
    name,
    fn,
  ) {
    if (!this.tracer) {
      return fn();
    }

    if (
      typeof this.tracer
        .startActiveSpan
        === 'function'
    ) {
      return new Promise(
        (
          resolve,
          reject,
        ) => {
          this.tracer
            .startActiveSpan(
              name,
              async (span) => {
                try {
                  const result =
                    await fn();

                  span
                    ?.setAttribute?.(
                      'provider',
                      PROVIDER,
                    );

                  span?.end?.();

                  resolve(
                    result,
                  );
                } catch (error) {
                  span
                    ?.recordException?.(
                      error,
                    );

                  span?.end?.();

                  reject(
                    error,
                  );
                }
              },
            );
        },
      );
    }

    if (
      typeof this.tracer
        .startSpan
        === 'function'
    ) {
      const span =
        this.tracer.startSpan(
          name,
        );

      try {
        const result =
          await fn();

        span?.end?.();

        return result;
      } catch (error) {
        span
          ?.recordException?.(
            error,
          );

        span?.end?.();

        throw error;
      }
    }

    return fn();
  }

  // ---------------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------------

  async _auditEvent(
    eventType,
    payload,
  ) {
    if (!this.audit) {
      return;
    }

    const event =
      this._safeEventPayload({
        eventType,

        ...payload,

        timestamp:
          nowIso(
            this.clock,
          ),
      });

    const methods = [
      'recordDecisionEvent',
      'record',
      'append',
      'write',
    ];

    for (
      const method
      of methods
    ) {
      if (
        typeof this.audit?.[
          method
        ]
        !== 'function'
      ) {
        continue;
      }

      try {
        await this.audit[
          method
        ](
          event,
        );
      } catch (error) {
        this._log(
          'warn',

          'Workflow scheduler audit write failed.',

          {
            code:
              error?.code
              || 'AUDIT_WRITE_FAILED',

            eventType,
          },
        );
      }

      return;
    }
  }

  async _emit(
    eventName,
    payload,
  ) {
    if (!this.eventBus) {
      return;
    }

    try {
      if (
        typeof this.eventBus
          .publish
        === 'function'
      ) {
        await this.eventBus
          .publish(
            eventName,
            payload,
          );

        return;
      }

      if (
        typeof this.eventBus
          .emit
        === 'function'
      ) {
        this.eventBus.emit(
          eventName,
          payload,
        );

        return;
      }

      if (
        typeof this.eventBus
          .dispatch
        === 'function'
      ) {
        await this.eventBus
          .dispatch(
            eventName,
            payload,
          );
      }
    } catch (error) {
      this._log(
        'warn',

        'Workflow scheduler event emission failed.',

        {
          eventName,

          code:
            error?.code
            || 'EVENT_EMISSION_FAILED',
        },
      );
    }
  }

  _safeEventPayload(
    schedule,
  ) {
    return redact({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      eventType:
        schedule.eventType
        || undefined,

      scheduleId:
        schedule.scheduleId,

      tenantDigest:
        schedule.tenantDigest,

      workflowId:
        schedule.workflowId,

      workflowVersion:
        schedule.workflowVersion,

      workflowFingerprint:
        schedule.workflowFingerprint,

      trigger:
        schedule.trigger,

      status:
        schedule.status,

      attempt:
        schedule.attempt,

      maxAttempts:
        schedule.maxAttempts,

      requestFingerprint:
        schedule.requestFingerprint,

      fingerprint:
        schedule.fingerprint,

      correlationId:
        schedule.correlationId,

      nextRunAt:
        schedule.nextRunAt,

      expiresAt:
        schedule.expiresAt,
    });
  }

  _metric(
    name,
    value = 1,
    labels = {},
  ) {
    try {
      if (
        typeof this.metrics
          ?.increment
        === 'function'
      ) {
        this.metrics.increment(
          name,
          value,
          {
            provider:
              PROVIDER,

            ...labels,
          },
        );
      } else if (
        typeof this.metrics?.inc
        === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          {
            provider:
              PROVIDER,

            ...labels,
          },
        );
      }
    } catch {
      // Metrics are non-authoritative.
    }
  }

  _log(
    level,
    message,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[level]
        || this.logger?.info;

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

          provider:
            PROVIDER,

          ...redact(
            context,
          ),
        },

        message,
      );
    } catch {
      // Logging must never affect scheduling semantics.
    }
  }

  // ---------------------------------------------------------------------------
  // Health / lifecycle
  // ---------------------------------------------------------------------------

  async health() {
    const repository =
      await this._safeHealthCheck(
        this.repository,
        'repository',
      );

    const workflowRegistry =
      await this._safeHealthCheck(
        this.workflowRegistry,
        'workflowRegistry',
      );

    const executor =
      this.workflowExecutor
        ? {
            name:
              'workflowExecutor',

            ok:
              true,

            status:
              'CONFIGURED',
          }
        : {
            name:
              'workflowExecutor',

            ok:
              false,

            status:
              'MISSING',
          };

    const status =
      repository.ok
      && workflowRegistry.ok
      && executor.ok
        ? 'UP'
        : repository.ok
          && workflowRegistry.ok
          ? 'DEGRADED'
          : 'DOWN';

    return this._freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      status,

      checkedAt:
        nowIso(
          this.clock,
        ),

      checks: [
        repository,
        workflowRegistry,
        executor,
      ],

      statistics: {
        ...this.statistics,
      },
    });
  }

  async readiness() {
    const health =
      await this.health();

    return this._freeze({
      ...health,

      ready:
        health.status
        === 'UP'
        || health.status
          === 'DEGRADED',
    });
  }

  getComponentInfo() {
    return this._freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      schemaVersion:
        SCHEMA_VERSION,

      moduleFormat:
        'ESM',

      inProcessTimer:
        false,

      backgroundWorker:
        false,

      executionDelegated:
        true,

      financialPostingAuthority:
        false,

      settlementAuthority:
        false,

      ledgerMutationAuthority:
        false,

      supportedStatuses:
        [
          ...VALID_STATUS_SET,
        ],

      supportedTriggers:
        [
          ...VALID_TRIGGER_SET,
        ],

      supportedScopes:
        [
          ...VALID_SCOPE_SET,
        ],
    });
  }

  async close() {
    if (this._closed) {
      return;
    }

    this._closed = true;

    if (
      typeof this.repository?.close
      === 'function'
    ) {
      await this.repository.close();
    }
  }

  _assertOpen() {
    if (this._closed) {
      throw new WorkflowSchedulerError(
        ERROR_CODES.CLOSED,

        'Workflow scheduler is closed.',

        503,
      );
    }
  }

  _freeze(value) {
    return deepFreeze(
      redact(value),
    );
  }

  _normalizeError(
    error,
  ) {
    if (
      error
      instanceof WorkflowSchedulerError
    ) {
      return {
        code:
          error.code,

        status:
          error.status,

        message:
          error.message,
      };
    }

    return {
      code:
        ERROR_CODES
          .PERSISTENCE_FAILED,

      status:
        500,

      message:
        'Workflow scheduler operation failed.',
    };
  }

  async _safeHealthCheck(
    adapter,
    name,
  ) {
    if (!adapter) {
      return {
        name,

        ok:
          false,

        status:
          'MISSING',
      };
    }

    const method =
      [
        'health',
        'readiness',
        'healthCheck',
      ].find(
        (candidate) =>
          typeof adapter?.[
            candidate
          ]
          === 'function',
      );

    if (!method) {
      return {
        name,

        ok:
          false,

        status:
          'UNSUPPORTED',
      };
    }

    try {
      const result =
        await this._withTimeout(
          Promise.resolve(
            adapter[method]({
              provider:
                PROVIDER,
            }),
          ),
          Math.min(
            this.config
              .defaultTimeoutMs,
            5_000,
          ),
        );

      const status =
        normalizeString(
          result?.status
          || result?.state
          || 'UNKNOWN',
          50,
        ).toUpperCase();

      return {
        name,

        ok:
          ![
            'DOWN',
            'FAILED',
            'UNAVAILABLE',
            'ERROR',
            'NOT_READY',
            'SHUTDOWN',
          ].includes(
            status,
          ),

        status,

        details:
          redact(
            result,
          ),
      };
    } catch (error) {
      const normalized =
        this._normalizeError(
          error,
        );

      return {
        name,

        ok:
          false,

        status:
          normalized.code,
      };
    }
  }
}

// =============================================================================
// Factories / aliases / helpers
// =============================================================================

export function createWorkflowScheduler(
  options = {},
) {
  return new AirtelWorkflowScheduler(
    options,
  );
}

export function createAirtelWorkflowScheduler(
  options = {},
) {
  return new AirtelWorkflowScheduler({
    ...options,

    config: {
      ...(options.config || {}),

      provider:
        PROVIDER,
    },
  });
}

export const WorkflowScheduler =
  AirtelWorkflowScheduler;

export const AirtelPaymentWorkflowScheduler =
  AirtelWorkflowScheduler;

export const PaymentWorkflowScheduler =
  AirtelWorkflowScheduler;

export function buildWorkflowScheduleFingerprint(
  input = {},
) {
  return sha256({
    provider:
      PROVIDER,

    tenantDigest:
      sha256(
        normalizeTenantId(
          input.tenantId,
        )
        || 'system',
      ),

    workflowId:
      normalizeString(
        input.workflowId
        || input.workflow?.workflowId,
        200,
      ).toLowerCase(),

    workflowVersion:
      normalizeString(
        input.version
        || input.workflowVersion,
        80,
      )
      || null,

    trigger:
      normalizeString(
        input.trigger,
        40,
      ).toUpperCase()
      || SCHEDULE_TRIGGER.MANUAL,

    nextRunAt:
      input.nextRunAt
      || null,

    expiresAt:
      input.expiresAt
      || null,

    timeoutMs:
      normalizeInteger(
        input.timeoutMs,
        DEFAULT_CONFIG
          .defaultTimeoutMs,
        100,
        DEFAULT_CONFIG
          .maxTimeoutMs,
      ),

    leaseMs:
      normalizeInteger(
        input.leaseMs,
        DEFAULT_CONFIG
          .defaultLeaseMs,
        1_000,
        DEFAULT_CONFIG
          .maxLeaseMs,
      ),

    retryPolicy:
      input.retryPolicy
      || DEFAULT_RETRY_POLICY,

    batchSize:
      normalizeInteger(
        input.batchSize,
        1,
        1,
        DEFAULT_CONFIG
          .maxBatchSize,
      ),

    input:
      redact(
        input.input
        || input.payload
        || {},
      ),

    metadata:
      redact(
        input.metadata
        || {},
      ),
  });
}

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,

    SCHEDULE_STATUS,
    SCHEDULE_TRIGGER,
    SCHEDULE_SCOPE,
    EXECUTION_OUTCOME,

    ERROR_CODES,
    DEFAULT_RETRY_POLICY,
  });

export default AirtelWorkflowScheduler;