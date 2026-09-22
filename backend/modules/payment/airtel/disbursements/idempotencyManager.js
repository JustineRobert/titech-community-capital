'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Idempotency Manager
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/idempotencyManager.js
 *
 * Architectural role
 * ------------------
 * Canonical financial-identity and idempotency boundary for Airtel outbound
 * disbursements. The manager binds one tenant-scoped original idempotency key to
 * one immutable financial intent and provides atomic reserve/commit/replay
 * semantics to callers such as disbursementService.js, workers and recovery
 * workflows.
 *
 * Responsibilities
 * ----------------
 * - Require and normalize the original financial idempotency identity.
 * - Scope keys by tenant + provider + operation.
 * - Generate deterministic semantic request fingerprints.
 * - Atomically reserve an idempotency identity before durable processing.
 * - Detect duplicate/replay requests and semantic conflicts.
 * - Support safe reservation leases and controlled expiry/reclaim.
 * - Commit an identity to its canonical resource without treating that commit as
 *   payment settlement.
 * - Release a reservation after a pre-execution persistence failure when safely
 *   permitted by policy.
 * - Provide optimistic-concurrency-safe state transitions through injected
 *   repository methods.
 * - Emit privacy-preserving audit/event/metric evidence.
 * - Preserve the original key across provider retries and recovery operations.
 *
 * Non-responsibilities
 * --------------------
 * - No Airtel API calls.
 * - No provider credential/token management.
 * - No ledger, journal, wallet or balance mutation.
 * - No payment authorization or maker-checker approval.
 * - No settlement or reconciliation finality.
 * - No generation of a replacement financial identity for retries.
 * - No direct MongoDB/Redis access; persistence is injected through a repository
 *   or atomic idempotency-store adapter.
 *
 * Financial safety principles
 * ---------------------------
 * 1. The original idempotency key is immutable for the lifetime of the financial
 *    intent.
 * 2. A retry of the same financial intent reuses the original key; it does not
 *    create a new financial identity.
 * 3. A different request reusing an existing key is an idempotency conflict,
 *    never a second transaction.
 * 4. Reservation state is not settlement state.
 * 5. COMMITTED means the identity is durably bound to a canonical resource; it
 *    does not mean the provider or Financial Core settled money.
 * 6. An active reservation owned by another worker must not be stolen merely to
 *    make progress. Reclaim requires explicit atomic lease-expiry support.
 * 7. Provider ambiguity must not be "solved" by allocating another key.
 * 8. Raw keys and sensitive request material are not emitted in audit or logs.
 * 9. Production persistence must enforce a tenant/provider/operation/key unique
 *    constraint at the database boundary.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins plus the canonical disbursement constants.
 * =============================================================================
 */

import {
  createHash,
  randomUUID,
} from 'node:crypto';

import {
  PROVIDER,
  OPERATION,
  SCHEMA_VERSION,
  LIMITS,
  TTL_POLICY_MS,
} from './constants.js';

export const ENGINE_NAME =
  'airtel-disbursement-idempotency-manager';

export const ENGINE_VERSION =
  '3.0.0';

export const COMPONENT =
  ENGINE_NAME;

export const IDEMPOTENCY_STATES =
  Object.freeze({
    RESERVED:
      'RESERVED',

    COMMITTED:
      'COMMITTED',

    RELEASED:
      'RELEASED',

    EXPIRED:
      'EXPIRED',

    FAILED:
      'FAILED',
  });

export const IDEMPOTENCY_OUTCOMES =
  Object.freeze({
    RESERVED:
      'RESERVED',

    ALREADY_RESERVED:
      'ALREADY_RESERVED',

    COMMITTED:
      'COMMITTED',

    REPLAY:
      'REPLAY',

    CONFLICT:
      'CONFLICT',

    RELEASED:
      'RELEASED',

    EXPIRED:
      'EXPIRED',

    IN_FLIGHT:
      'IN_FLIGHT',

    RECLAIMED:
      'RECLAIMED',
  });

export const IDEMPOTENCY_ACTIONS =
  Object.freeze({
    RESERVE:
      'RESERVE',

    RECLAIM:
      'RECLAIM',

    COMMIT:
      'COMMIT',

    RELEASE:
      'RELEASE',

    EXPIRE:
      'EXPIRE',

    FAIL:
      'FAIL',
  });

export const IDEMPOTENCY_REASON_CODES =
  Object.freeze({
    TENANT_REQUIRED:
      'IDEMPOTENCY_TENANT_REQUIRED',

    PROVIDER_SCOPE_VIOLATION:
      'IDEMPOTENCY_PROVIDER_SCOPE_VIOLATION',

    OPERATION_SCOPE_VIOLATION:
      'IDEMPOTENCY_OPERATION_SCOPE_VIOLATION',

    KEY_REQUIRED:
      'IDEMPOTENCY_KEY_REQUIRED',

    KEY_TOO_LONG:
      'IDEMPOTENCY_KEY_TOO_LONG',

    KEY_INVALID:
      'IDEMPOTENCY_KEY_INVALID',

    FINGERPRINT_REQUIRED:
      'IDEMPOTENCY_FINGERPRINT_REQUIRED',

    FINGERPRINT_CONFLICT:
      'IDEMPOTENCY_FINGERPRINT_CONFLICT',

    EXISTING_REQUEST_CONFLICT:
      'IDEMPOTENCY_EXISTING_REQUEST_CONFLICT',

    RESERVATION_ACTIVE:
      'IDEMPOTENCY_RESERVATION_ACTIVE',

    LEASE_EXPIRED:
      'IDEMPOTENCY_LEASE_EXPIRED',

    RECLAIM_UNAVAILABLE:
      'IDEMPOTENCY_RECLAIM_UNAVAILABLE',

    COMMIT_CONFLICT:
      'IDEMPOTENCY_COMMIT_CONFLICT',

    RELEASE_CONFLICT:
      'IDEMPOTENCY_RELEASE_CONFLICT',

    REPOSITORY_REQUIRED:
      'IDEMPOTENCY_REPOSITORY_REQUIRED',

    REPOSITORY_UNAVAILABLE:
      'IDEMPOTENCY_REPOSITORY_UNAVAILABLE',

    ATOMIC_OPERATION_REQUIRED:
      'IDEMPOTENCY_ATOMIC_OPERATION_REQUIRED',

    STALE_VERSION:
      'IDEMPOTENCY_STALE_VERSION',

    TENANT_SCOPE_MISMATCH:
      'IDEMPOTENCY_TENANT_SCOPE_MISMATCH',

    INTERNAL_ERROR:
      'IDEMPOTENCY_INTERNAL_ERROR',
  });

const DEFAULT_CONFIG =
  Object.freeze({
    requireTenantId:
      true,

    requireOriginalIdempotencyKey:
      true,

    requireRequestFingerprint:
      true,

    enforceAirtelProvider:
      true,

    enforceDisbursementOperation:
      true,

    requireAtomicRepository:
      true,

    reservationTtlMs:
      24 *
      60 *
      60 *
      1000,

    minimumReservationTtlMs:
      30 *
      1000,

    maximumReservationTtlMs:
      7 *
      24 *
      60 *
      60 *
      1000,

    reclaimExpiredReservations:
      false,

    allowReleasedReuse:
      true,

    allowReleasedReuseOnlyWithoutResource:
      true,

    failClosedOnAuditError:
      false,

    failClosedOnEventError:
      false,

    maxMetadataDepth:
      LIMITS.metadataDepth,

    maxMetadataKeys:
      LIMITS.metadataKeys,

    maxMetadataArrayLength:
      LIMITS.metadataArrayLength,

    maxMetadataStringLength:
      LIMITS.metadataStringLength,
  });

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|credential)/i;

const FORBIDDEN_KEYS =
  new Set([
    '__proto__',
    'prototype',
    'constructor',
  ]);

const isPlainObject = (
  value,
) =>
  Boolean(
    value &&
      typeof value ===
        'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) ===
        Object.prototype,
  );

const isFunction = (
  value,
) =>
  typeof value ===
  'function';

const text = (
  value,
  maxLength = 240,
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(
    0,
    maxLength,
  );
};

const upper = (
  value,
) =>
  text(
    value,
    120,
  )?.toUpperCase();

const clone = (
  value,
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  return JSON.parse(
    JSON.stringify(value),
  );
};

const deepFreeze = (
  value,
  seen = new WeakSet(),
) => {
  if (
    !value ||
    typeof value !==
      'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const nested of Object.values(
      value,
    )
  ) {
    deepFreeze(
      nested,
      seen,
    );
  }

  return Object.freeze(
    value,
  );
};

const stable = (
  value,
) => {
  if (
    value === null
  ) {
    return null;
  }

  if (
    value === undefined
  ) {
    return '[undefined]';
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      stable,
    );
  }

  if (
    isPlainObject(
      value,
    )
  ) {
    return Object.keys(
      value,
    )
      .filter(
        (key) =>
          !FORBIDDEN_KEYS.has(
            key,
          ),
      )
      .sort()
      .reduce(
        (
          output,
          key,
        ) => {
          output[key] =
            stable(
              value[key],
            );

          return output;
        },
        {},
      );
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return `${value}`;
  }

  return value;
};

const sha256 = (
  value,
) =>
  createHash(
    'sha256',
  )
    .update(
      typeof value ===
        'string'
        ? value
        : JSON.stringify(
            stable(
              value,
            ),
          ),
    )
    .digest('hex');

const sanitize = (
  value,
  config,
  depth = 0,
) => {
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

  if (
    typeof value ===
      'string' ||
    typeof value ===
      'number' ||
    typeof value ===
      'boolean'
  ) {
    return typeof value ===
      'string'
      ? value.slice(
          0,
          config.maxMetadataStringLength,
        )
      : value;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        config.maxMetadataArrayLength,
      )
      .map(
        (
          item,
        ) =>
          sanitize(
            item,
            config,
            depth + 1,
          ),
      );
  }

  if (
    !isPlainObject(
      value,
    )
  ) {
    return undefined;
  }

  const output = {};

  for (
    const key of Object.keys(
      value,
    ).slice(
      0,
      config.maxMetadataKeys,
    )
  ) {
    if (
      FORBIDDEN_KEYS.has(
        key,
      )
    ) {
      continue;
    }

    if (
      SENSITIVE_KEY_PATTERN.test(
        key,
      )
    ) {
      output[key] =
        '[REDACTED]';

      continue;
    }

    output[key] =
      sanitize(
        value[key],
        config,
        depth + 1,
      );
  }

  return output;
};

const nowMs = (
  clock,
) => {
  try {
    if (
      isFunction(
        clock,
      )
    ) {
      const result =
        clock();

      const numeric =
        result instanceof Date
          ? result.getTime()
          : Number(
              result,
            );

      if (
        Number.isFinite(
          numeric,
        )
      ) {
        return numeric;
      }
    }
  } catch {
    // Fall through to system time.
  }

  return Date.now();
};

const nowIso = (
  clock,
) =>
  new Date(
    nowMs(
      clock,
    ),
  ).toISOString();

const normalizeTtl = (
  value,
  config,
) => {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return config.reservationTtlMs;
  }

  return Math.min(
    config.maximumReservationTtlMs,
    Math.max(
      config.minimumReservationTtlMs,
      Math.floor(
        numeric,
      ),
    ),
  );
};

const normalizeState = (
  value,
) =>
  upper(value);

const isState = (
  value,
  state,
) =>
  normalizeState(
    value,
  ) === state;

const isExpired = (
  record,
  now,
) => {
  const expiresAt =
    record?.leaseExpiresAt ??
    record?.expiresAt;

  if (!expiresAt) {
    return false;
  }

  const timestamp =
    expiresAt instanceof Date
      ? expiresAt.getTime()
      : new Date(
          expiresAt,
        ).getTime();

  return (
    Number.isFinite(
      timestamp,
    ) &&
    timestamp <= now
  );
};

const hasResource = (
  record,
) =>
  Boolean(
    record?.resourceId ??
      record?.disbursementId,
  );

const safeActorId = (
  actor,
) =>
  text(
    actor?.actorId ??
      actor?.userId ??
      actor?.principalId ??
      actor?.id,
    LIMITS.actorIdLength,
  );

const duplicateError = (
  error,
) => {
  const code =
    upper(
      error?.code ??
        error?.name,
    );

  return (
    Boolean(
      error?.keyPattern,
    ) ||
    Boolean(
      error?.duplicate,
    ) ||
    code ===
      'E11000' ||
    code ===
      'DUPLICATE_KEY' ||
    code ===
      'DUPLICATE'
  );
};

const extractRecord = (
  result,
) =>
  result?.record ??
  result?.entry ??
  result?.item ??
  result?.value ??
  result ??
  null;

export class AirtelIdempotencyManagerError
  extends Error
{
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'AirtelIdempotencyManagerError';

    this.code =
      code;

    this.statusCode =
      options.statusCode ??
      400;

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.details =
      details;
  }

  toJSON() {
    return {
      name:
        this.name,

      code:
        this.code,

      message:
        this.message,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      details:
        this.details,
    };
  }
}

export const buildIdempotencyFingerprint = (
  input = {},
) => {
  const explicit =
    text(
      input.requestFingerprint ??
        input.disbursementFingerprint ??
        input.semanticFingerprint,
      128,
    );

  if (
    explicit
  ) {
    return explicit;
  }

  const beneficiaryFingerprint =
    text(
      input.beneficiaryFingerprint ??
        input.beneficiary?.fingerprint ??
        input.beneficiary
          ?.beneficiaryFingerprint,
      128,
    ) ??
    (
      input.beneficiary
        ? sha256(
            input.beneficiary,
          )
        : undefined
    );

  return sha256({
    schemaVersion:
      SCHEMA_VERSION,

    tenantId:
      text(
        input.tenantId,
        LIMITS.tenantIdLength,
      ),

    provider:
      upper(
        input.provider ??
          PROVIDER,
      ),

    operation:
      upper(
        input.operation ??
          OPERATION,
      ),

    transactionId:
      text(
        input.transactionId,
        LIMITS.transactionIdLength,
      ),

    reference:
      text(
        input.reference ??
          input.paymentReference,
        LIMITS.referenceLength,
      ),

    amountMinor:
      text(
        input.amountMinor ??
          input.amountInMinorUnits,
        64,
      ),

    currency:
      upper(
        input.currency ??
          'UGX',
      ),

    beneficiaryFingerprint,

    purposeCode:
      text(
        input.purposeCode,
        120,
      ),

    merchantReference:
      text(
        input.merchantReference,
        LIMITS.referenceLength,
      ),

    requestFingerprint:
      explicit,

    // Metadata can legitimately contain volatile values. It is deliberately
    // excluded unless callers provide an explicit semantic fingerprint.
  });
};

export class AirtelIdempotencyManager {
  constructor(
    options = {},
  ) {
    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,

        ...(options.config ??
          options.configuration ??
          {}),
      });

    this.repository =
      options.repository ??
      options.store ??
      options.idempotencyRepository ??
      null;

    this.auditService =
      options.auditService ??
      options.audit ??
      null;

    this.eventBus =
      options.eventBus ??
      options.eventPublisher ??
      options.outbox ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.logger =
      options.logger ??
      null;

    this.clock =
      options.clock ??
      (() =>
        Date.now());

    this.idFactory =
      options.idFactory ??
      (() =>
        `idem_${randomUUID()}`);

    this.statistics = {
      reserveAttempts:
        0,

      reservations:
        0,

      replays:
        0,

      conflicts:
        0,

      commits:
        0,

      releases:
        0,

      reclaimAttempts:
        0,

      reclaimSuccesses:
        0,

      failures:
        0,
    };
  }

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new AirtelIdempotencyManagerError(
      code,
      message,
      sanitize(
        details,
        this.config,
      ),
      options,
    );
  }

  #repo(
    ...methods
  ) {
    for (
      const method of methods
    ) {
      if (
        isFunction(
          this.repository?.[
            method
          ],
        )
      ) {
        return this.repository[
          method
        ].bind(
          this.repository,
        );
      }
    }

    return null;
  }

  #normalize(
    input = {},
  ) {
    if (
      !isPlainObject(
        input,
      )
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.INTERNAL_ERROR,
        'Idempotency input must be a plain object.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const tenantId =
      text(
        input.tenantId,
        LIMITS.tenantIdLength,
      );

    if (
      this.config
        .requireTenantId &&
      !tenantId
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.TENANT_REQUIRED,
        'tenantId is required for idempotency.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const provider =
      upper(
        input.provider ??
          PROVIDER,
      );

    if (
      this.config
        .enforceAirtelProvider &&
      provider !== PROVIDER
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.PROVIDER_SCOPE_VIOLATION,
        'Idempotency manager is scoped to Airtel.',
        {
          provider,
        },
        {
          statusCode:
            409,
        },
      );
    }

    const operation =
      upper(
        input.operation ??
          OPERATION,
      );

    if (
      this.config
        .enforceDisbursementOperation &&
      operation !== OPERATION
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.OPERATION_SCOPE_VIOLATION,
        'Idempotency manager is scoped to Airtel disbursements.',
        {
          operation,
        },
        {
          statusCode:
            409,
        },
      );
    }

    const key =
      text(
        input.originalIdempotencyKey ??
          input.idempotencyKey ??
          input.key ??
          input.headers?.[
            'idempotency-key'
          ],
        LIMITS.idempotencyKeyLength,
      );

    if (
      this.config
        .requireOriginalIdempotencyKey &&
      !key
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.KEY_REQUIRED,
        'The original financial idempotency key is required.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    if (
      key &&
      key.length >
        LIMITS.idempotencyKeyLength
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.KEY_TOO_LONG,
        'Idempotency key exceeds the maximum permitted length.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const fingerprint =
      buildIdempotencyFingerprint(
        input,
      );

    if (
      this.config
        .requireRequestFingerprint &&
      !fingerprint
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.FINGERPRINT_REQUIRED,
        'A deterministic idempotency request fingerprint is required.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const ownerId =
      text(
        input.ownerId ??
          input.workerId ??
          safeActorId(
            input.actor,
          ),
        LIMITS.actorIdLength,
      );

    const ttlMs =
      normalizeTtl(
        input.ttlMs ??
          input.reservationTtlMs,
        this.config,
      );

    return {
      tenantId,

      provider,

      operation,

      key,

      keyHash:
        sha256(
          key ?? '',
        ),

      fingerprint,

      ownerId,

      ttlMs,

      resourceId:
        text(
          input.resourceId ??
            input.disbursementId,
          LIMITS.paymentIdLength,
        ),

      resourceType:
        text(
          input.resourceType ??
            'AIRTEL_DISBURSEMENT',
          160,
        ),

      transactionId:
        text(
          input.transactionId,
          LIMITS.transactionIdLength,
        ),

      reference:
        text(
          input.reference,
          LIMITS.referenceLength,
        ),

      requestId:
        text(
          input.requestId,
          LIMITS.requestIdLength,
        ),

      correlationId:
        text(
          input.correlationId,
          LIMITS.correlationIdLength,
        ),

      traceId:
        text(
          input.traceId,
          LIMITS.traceIdLength,
        ),

      metadata:
        sanitize(
          input.metadata ?? {},
          this.config,
        ),
    };
  }

  #scope(
    input,
  ) {
    return {
      tenantId:
        input.tenantId,

      provider:
        input.provider,

      operation:
        input.operation,

      keyHash:
        input.keyHash,
    };
  }

  #recordPayload(
    input,
    now,
    state =
      IDEMPOTENCY_STATES.RESERVED,
  ) {
    return {
      idempotencyId:
        this.idFactory(),

      tenantId:
        input.tenantId,

      provider:
        input.provider,

      operation:
        input.operation,

      idempotencyKey:
        input.key,

      idempotencyKeyHash:
        input.keyHash,

      originalIdempotencyKeyHash:
        input.keyHash,

      requestFingerprint:
        input.fingerprint,

      state,

      resourceId:
        input.resourceId,

      resourceType:
        input.resourceType,

      transactionId:
        input.transactionId,

      reference:
        input.reference,

      ownerId:
        input.ownerId,

      leaseExpiresAt:
        new Date(
          now +
            input.ttlMs,
        ).toISOString(),

      expiresAt:
        new Date(
          now +
            input.ttlMs,
        ).toISOString(),

      version:
        1,

      attempts:
        1,

      metadata:
        input.metadata,

      createdAt:
        new Date(
          now,
        ).toISOString(),

      updatedAt:
        new Date(
          now,
        ).toISOString(),
    };
  }

  #safeRecord(
    record,
  ) {
    if (!record) {
      return null;
    }

    const output =
      clone(
        record,
      );

    if (
      Object.prototype.hasOwnProperty.call(
        output,
        'idempotencyKey',
      )
    ) {
      delete output.idempotencyKey;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        output,
        'originalIdempotencyKey',
      )
    ) {
      delete output.originalIdempotencyKey;
    }

    return sanitize(
      output,
      this.config,
    );
  }

  #assertFingerprint(
    existing,
    input,
  ) {
    const existingFingerprint =
      text(
        existing?.requestFingerprint ??
          existing?.semanticFingerprint ??
          existing?.fingerprint,
        128,
      );

    if (
      existingFingerprint &&
      input.fingerprint &&
      existingFingerprint !==
        input.fingerprint
    ) {
      this.statistics.conflicts +=
        1;

      this.#throw(
        IDEMPOTENCY_REASON_CODES.FINGERPRINT_CONFLICT,
        'Idempotency key is already associated with a different financial intent.',
        {
          tenantId:
            input.tenantId,

          provider:
            input.provider,

          operation:
            input.operation,

          keyHash:
            input.keyHash,

          existingFingerprint,

          requestedFingerprint:
            input.fingerprint,
        },
        {
          statusCode:
            409,
        },
      );
    }
  }

  #assertTenant(
    existing,
    input,
  ) {
    if (
      existing?.tenantId &&
      existing.tenantId !==
        input.tenantId
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.TENANT_SCOPE_MISMATCH,
        'Idempotency record belongs to another tenant.',
        {},
        {
          statusCode:
            404,
        },
      );
    }
  }

  async #find(
    input,
  ) {
    const fn =
      this.#repo(
        'findByKey',
        'findByIdempotencyKey',
        'getByKey',
        'getByIdempotencyKey',
        'find',
      );

    if (!fn) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.REPOSITORY_REQUIRED,
        'An idempotency repository is required.',
        {},
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    return extractRecord(
      await fn({
        ...this.#scope(
          input,
        ),

        idempotencyKey:
          input.key,

        originalIdempotencyKey:
          input.key,
      }),
    );
  }

  async #atomicCreate(
    input,
    record,
  ) {
    const fn =
      this.#repo(
        'reserveAtomically',
        'atomicReserve',
        'createIfAbsent',
        'insertIfAbsent',
        'reserve',
        'create',
      );

    if (!fn) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.ATOMIC_OPERATION_REQUIRED,
        'Repository does not expose an atomic idempotency reservation operation.',
        {},
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    try {
      const raw =
        await fn({
          ...record,

          scope:
            this.#scope(
              input,
            ),

          expectedAbsent:
            true,
        });

      // Some repositories return a native { created, record } envelope while
      // others return the created record directly. Normalize both contracts.
      if (
        raw &&
        typeof raw ===
          'object' &&
        (
          Object.prototype.hasOwnProperty.call(
            raw,
            'created',
          ) ||
          Object.prototype.hasOwnProperty.call(
            raw,
            'inserted',
          )
        )
      ) {
        return {
          created:
            raw.created ??
            raw.inserted ??
            false,

          record:
            extractRecord(
              raw,
            ),
        };
      }

      return {
        created:
          true,

        record:
          extractRecord(
            raw,
          ),
      };
    } catch (error) {
      if (
        duplicateError(
          error,
        )
      ) {
        return {
          created:
            false,

          record:
            await this.#find(
              input,
            ),
        };
      }

      throw error;
    }
  }

  async #atomicReclaim(
    input,
    existing,
    now,
  ) {
    this.statistics.reclaimAttempts +=
      1;

    const fn =
      this.#repo(
        'reclaimExpiredAtomically',
        'atomicReclaim',
        'reclaimExpired',
      );

    if (!fn) {
      return null;
    }

    const result =
      extractRecord(
        await fn({
          ...this.#scope(
            input,
          ),

          idempotencyKey:
            input.key,

          expectedState:
            IDEMPOTENCY_STATES.RESERVED,

          expectedVersion:
            Number(
              existing?.version ??
                1,
            ),

          expectedLeaseExpiresAt:
            existing?.leaseExpiresAt ??
            existing?.expiresAt,

          requestFingerprint:
            input.fingerprint,

          ownerId:
            input.ownerId,

          leaseExpiresAt:
            new Date(
              now +
                input.ttlMs,
            ).toISOString(),

          updatedAt:
            new Date(
              now,
            ).toISOString(),
        }),
      );

    if (result) {
      this.statistics.reclaimSuccesses +=
        1;
    }

    return result;
  }

  async #atomicReopenReleased(
    input,
    existing,
    now,
  ) {
    const fn =
      this.#repo(
        'reopenReleasedAtomically',
        'atomicReopenReleased',
        'reopenReleased',
      );

    if (!fn) {
      return null;
    }

    return extractRecord(
      await fn({
        ...this.#scope(
          input,
        ),

        idempotencyKey:
          input.key,

        expectedState:
          IDEMPOTENCY_STATES.RELEASED,

        expectedVersion:
          Number(
            existing?.version ??
              1,
          ),

        expectedFingerprint:
          input.fingerprint,

        resourceId:
          input.resourceId,

        ownerId:
          input.ownerId,

        leaseExpiresAt:
          new Date(
            now +
              input.ttlMs,
          ).toISOString(),

        updatedAt:
          new Date(
            now,
          ).toISOString(),
      }),
    );
  }

  async #atomicCommit(
    input,
    existing,
    patch = {},
  ) {
    const fn =
      this.#repo(
        'commitAtomically',
        'atomicCommit',
        'commit',
        'finalize',
        'complete',
        'markCommitted',
      );

    if (!fn) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.ATOMIC_OPERATION_REQUIRED,
        'Repository does not expose an atomic idempotency commit operation.',
        {},
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const result =
      extractRecord(
        await fn({
          ...this.#scope(
            input,
          ),

          idempotencyKey:
            input.key,

          expectedState:
            existing.state,

          expectedVersion:
            Number(
              existing.version ??
                1,
            ),

          expectedFingerprint:
            input.fingerprint,

          resourceId:
            input.resourceId ??
            existing.resourceId,

          resourceType:
            input.resourceType ??
            existing.resourceType,

          patch: {
            state:
              IDEMPOTENCY_STATES.COMMITTED,

            resourceId:
              input.resourceId ??
              existing.resourceId,

            resourceType:
              input.resourceType ??
              existing.resourceType,

            transactionId:
              input.transactionId ??
              existing.transactionId,

            reference:
              input.reference ??
              existing.reference,

            committedAt:
              nowIso(
                this.clock,
              ),

            updatedAt:
              nowIso(
                this.clock,
              ),

            version:
              Number(
                existing.version ??
                  1,
              ) + 1,

            ...sanitize(
              patch,
              this.config,
            ),
          },
        }),
      );

    if (!result) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.STALE_VERSION,
        'Idempotency commit lost an optimistic-concurrency race.',
        {},
        {
          statusCode:
            409,
        },
      );
    }

    return result;
  }

  async #atomicRelease(
    input,
    existing,
    reason,
  ) {
    const fn =
      this.#repo(
        'releaseAtomically',
        'atomicRelease',
        'release',
        'rollback',
        'unlock',
      );

    if (!fn) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.ATOMIC_OPERATION_REQUIRED,
        'Repository does not expose an atomic idempotency release operation.',
        {},
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const result =
      extractRecord(
        await fn({
          ...this.#scope(
            input,
          ),

          idempotencyKey:
            input.key,

          expectedState:
            existing.state,

          expectedVersion:
            Number(
              existing.version ??
                1,
            ),

          expectedFingerprint:
            input.fingerprint,

          reason:
            text(
              reason,
              500,
            ),

          patch: {
            state:
              IDEMPOTENCY_STATES.RELEASED,

            releaseReason:
              text(
                reason,
                500,
              ),

            releasedAt:
              nowIso(
                this.clock,
              ),

            updatedAt:
              nowIso(
                this.clock,
              ),

            version:
              Number(
                existing.version ??
                  1,
              ) + 1,
          },
        }),
      );

    if (!result) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.STALE_VERSION,
        'Idempotency release lost an optimistic-concurrency race.',
        {},
        {
          statusCode:
            409,
        },
      );
    }

    return result;
  }

  async #audit(
    action,
    record,
    extra = {},
  ) {
    const fn =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write;

    if (
      !isFunction(
        fn,
      )
    ) {
      return null;
    }

    const payload = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      action,

      tenantId:
        record?.tenantId,

      idempotencyKeyHash:
        record?.idempotencyKeyHash ??
        record?.originalIdempotencyKeyHash,

      requestFingerprint:
        record?.requestFingerprint,

      state:
        record?.state,

      resourceId:
        record?.resourceId,

      transactionId:
        record?.transactionId,

      reference:
        record?.reference,

      ownerId:
        record?.ownerId,

      extra:
        sanitize(
          extra,
          this.config,
        ),

      occurredAt:
        nowIso(
          this.clock,
        ),
    };

    try {
      return await fn.call(
        this.auditService,
        {
          ...payload,

          auditFingerprint:
            sha256(
              payload,
            ),
        },
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel idempotency audit write failed.',
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
        this.#throw(
          IDEMPOTENCY_REASON_CODES.REPOSITORY_UNAVAILABLE,
          'Idempotency audit boundary is unavailable.',
          {},
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }
  }

  async #emit(
    type,
    record,
    extra = {},
  ) {
    const fn =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (
      !isFunction(
        fn,
      )
    ) {
      return null;
    }

    const event = {
      eventId:
        this.idFactory(),

      type,

      occurredAt:
        nowIso(
          this.clock,
        ),

      tenantId:
        record?.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      idempotencyKeyHash:
        record?.idempotencyKeyHash ??
        record?.originalIdempotencyKeyHash,

      requestFingerprint:
        record?.requestFingerprint,

      state:
        record?.state,

      resourceId:
        record?.resourceId,

      payload:
        sanitize(
          extra,
          this.config,
        ),
    };

    try {
      return await fn.call(
        this.eventBus,
        event,
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel idempotency event publication failed.',
        {
          type,

          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        this.#throw(
          IDEMPOTENCY_REASON_CODES.REPOSITORY_UNAVAILABLE,
          'Idempotency event boundary is unavailable.',
          {},
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }
  }

  #log(
    level,
    message,
    context = {},
  ) {
    try {
      const fn =
        this.logger?.[
          level
        ] ??
        this.logger?.log ??
        this.logger?.info;

      if (
        !isFunction(
          fn,
        )
      ) {
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
            this.config,
          ),
        },
        message,
      );
    } catch {
      // Logging must never affect idempotency semantics.
    }
  }

  #metric(
    method,
    name,
    value,
  ) {
    try {
      const fn =
        this.metrics?.[
          method
        ];

      if (
        !isFunction(
          fn,
        )
      ) {
        return;
      }

      fn.call(
        this.metrics,
        name,
        value,
      );
    } catch {
      // Metrics are non-authoritative.
    }
  }

  async reserve(
    input = {},
  ) {
    this.statistics.reserveAttempts +=
      1;

    const normalized =
      this.#normalize(
        input,
      );

    const now =
      nowMs(
        this.clock,
      );

    if (
      this.config
        .requireAtomicRepository &&
      !this.repository
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.REPOSITORY_REQUIRED,
        'Production idempotency requires a durable atomic repository.',
        {},
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const existing =
      await this.#find(
        normalized,
      );

    if (
      existing
    ) {
      this.#assertTenant(
        existing,
        normalized,
      );

      this.#assertFingerprint(
        existing,
        normalized,
      );

      const state =
        normalizeState(
          existing.state,
        );

      if (
        state ===
        IDEMPOTENCY_STATES.COMMITTED
      ) {
        this.statistics.replays +=
          1;

        await this.#audit(
          'IDEMPOTENCY_REPLAY',
          existing,
        );

        return deepFreeze({
          reserved:
            false,

          existing:
            true,

          replay:
            true,

          idempotent:
            true,

          outcome:
            IDEMPOTENCY_OUTCOMES.REPLAY,

          state,

          record:
            this.#safeRecord(
              existing,
            ),
        });
      }

      if (
        state ===
        IDEMPOTENCY_STATES.RELEASED
      ) {
        if (
          !this.config
            .allowReleasedReuse
        ) {
          this.statistics.conflicts +=
            1;

          this.#throw(
            IDEMPOTENCY_REASON_CODES.EXISTING_REQUEST_CONFLICT,
            'Released idempotency identity cannot be reused by policy.',
            {},
            {
              statusCode:
                409,
            },
          );
        }

        if (
          this.config
            .allowReleasedReuseOnlyWithoutResource &&
          hasResource(
            existing,
          )
        ) {
          this.statistics.conflicts +=
            1;

          this.#throw(
            IDEMPOTENCY_REASON_CODES.EXISTING_REQUEST_CONFLICT,
            'Released idempotency identity is already bound to a resource and cannot be reused.',
            {},
            {
              statusCode:
                409,
            },
          );
        }

        const reopened =
          await this.#atomicReopenReleased(
            normalized,
            existing,
            now,
          );

        if (
          reopened
        ) {
          this.statistics.reservations +=
            1;

          return deepFreeze({
            reserved:
              true,

            existing:
              true,

            reclaimed:
              true,

            replay:
              false,

            idempotent:
              false,

            outcome:
              IDEMPOTENCY_OUTCOMES.RECLAIMED,

            state:
              IDEMPOTENCY_STATES.RESERVED,

            record:
              this.#safeRecord(
                reopened,
              ),
          });
        }
      }

      if (
        state ===
        IDEMPOTENCY_STATES.RESERVED
      ) {
        if (
          isExpired(
            existing,
            now,
          )
        ) {
          if (
            this.config
              .reclaimExpiredReservations
          ) {
            const reclaimed =
              await this.#atomicReclaim(
                normalized,
                existing,
                now,
              );

            if (
              reclaimed
            ) {
              return deepFreeze({
                reserved:
                  true,

                existing:
                  true,

                reclaimed:
                  true,

                replay:
                  false,

                idempotent:
                  false,

                outcome:
                  IDEMPOTENCY_OUTCOMES.RECLAIMED,

                state:
                  IDEMPOTENCY_STATES.RESERVED,

                record:
                  this.#safeRecord(
                    reclaimed,
                  ),
              });
            }
          }

          this.#throw(
            IDEMPOTENCY_REASON_CODES.LEASE_EXPIRED,
            'The idempotency reservation lease expired and cannot be safely reclaimed by the configured repository.',
            {
              keyHash:
                normalized.keyHash,
            },
            {
              statusCode:
                409,

              retryable:
                true,
            },
          );
        }

        this.#metric(
          'increment',
          'airtel.disbursement.idempotency.in_flight.total',
        );

        return deepFreeze({
          reserved:
            false,

          existing:
            true,

          replay:
            false,

          idempotent:
            false,

          inFlight:
            true,

          outcome:
            IDEMPOTENCY_OUTCOMES.IN_FLIGHT,

          state,

          record:
            this.#safeRecord(
              existing,
            ),
        });
      }

      if (
        state ===
          IDEMPOTENCY_STATES.EXPIRED ||
        state ===
          IDEMPOTENCY_STATES.FAILED
      ) {
        this.statistics.conflicts +=
          1;

        this.#throw(
          IDEMPOTENCY_REASON_CODES.EXISTING_REQUEST_CONFLICT,
          'Idempotency identity is in a terminal unusable state.',
          {
            state,
          },
          {
            statusCode:
              409,
          },
        );
      }
    }

    const record =
      this.#recordPayload(
        normalized,
        now,
      );

    try {
      const createdResult =
        await this.#atomicCreate(
          normalized,
          record,
        );

      const created =
        createdResult?.record ??
        null;

      if (
        createdResult?.created !==
        true
      ) {
        if (!created) {
          this.#throw(
            IDEMPOTENCY_REASON_CODES.REPOSITORY_UNAVAILABLE,
            'Idempotency reservation could not be established.',
            {},
            {
              statusCode:
                503,

              retryable:
                true,
            },
          );
        }

        this.#assertTenant(
          created,
          normalized,
        );

        this.#assertFingerprint(
          created,
          normalized,
        );

        const state =
          normalizeState(
            created.state,
          );

        if (
          state ===
          IDEMPOTENCY_STATES.COMMITTED
        ) {
          this.statistics.replays +=
            1;

          return deepFreeze({
            reserved:
              false,

            existing:
              true,

            replay:
              true,

            idempotent:
              true,

            inFlight:
              false,

            outcome:
              IDEMPOTENCY_OUTCOMES.REPLAY,

            state,

            record:
              this.#safeRecord(
                created,
              ),
          });
        }

        return deepFreeze({
          reserved:
            false,

          existing:
            true,

          replay:
            false,

          idempotent:
            false,

          inFlight:
            state ===
            IDEMPOTENCY_STATES.RESERVED,

          outcome:
            state ===
              IDEMPOTENCY_STATES.RESERVED
              ? IDEMPOTENCY_OUTCOMES.IN_FLIGHT
              : IDEMPOTENCY_OUTCOMES.ALREADY_RESERVED,

          state,

          record:
            this.#safeRecord(
              created,
            ),
        });
      }

      this.statistics.reservations +=
        1;

      await this.#audit(
        'IDEMPOTENCY_RESERVED',
        created,
      );

      await this.#emit(
        'PAYMENT.AIRTEL.DISBURSEMENT.IDEMPOTENCY_RESERVED',
        created,
      );

      this.#metric(
        'increment',
        'airtel.disbursement.idempotency.reserved.total',
      );

      return deepFreeze({
        reserved:
          true,

        existing:
          false,

        replay:
          false,

        idempotent:
          false,

        inFlight:
          false,

        outcome:
          IDEMPOTENCY_OUTCOMES.RESERVED,

        state:
          IDEMPOTENCY_STATES.RESERVED,

        record:
          this.#safeRecord(
            created,
          ),
      });
    } catch (error) {
      this.statistics.failures +=
        1;

      if (
        error instanceof
        AirtelIdempotencyManagerError
      ) {
        throw error;
      }

      this.#log(
        'error',
        'Airtel idempotency reservation failed.',
        {
          tenantId:
            normalized.tenantId,

          keyHash:
            normalized.keyHash,

          message:
            error?.message,
        },
      );

      this.#throw(
        IDEMPOTENCY_REASON_CODES.REPOSITORY_UNAVAILABLE,
        'Airtel idempotency reservation failed.',
        {},
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }
  }

  async claim(
    input = {},
  ) {
    return this.reserve(
      input,
    );
  }

  async acquire(
    input = {},
  ) {
    return this.reserve(
      input,
    );
  }

  async reserveKey(
    input = {},
  ) {
    return this.reserve(
      input,
    );
  }

  async commit(
    input = {},
  ) {
    const normalized =
      this.#normalize(
        input,
      );

    let existing =
      input.record ??
      (
        await this.#find(
          normalized,
        )
      );

    if (!existing) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.COMMIT_CONFLICT,
        'Cannot commit an idempotency key that has not been reserved.',
        {},
        {
          statusCode:
            409,
        },
      );
    }

    this.#assertTenant(
      existing,
      normalized,
    );

    this.#assertFingerprint(
      existing,
      normalized,
    );

    const state =
      normalizeState(
        existing.state,
      );

    if (
      state ===
      IDEMPOTENCY_STATES.COMMITTED
    ) {
      this.statistics.replays +=
        1;

      return deepFreeze({
        committed:
          false,

        existing:
          true,

        replay:
          true,

        idempotent:
          true,

        outcome:
          IDEMPOTENCY_OUTCOMES.REPLAY,

        state,

        record:
          this.#safeRecord(
            existing,
          ),
      });
    }

    if (
      state !==
      IDEMPOTENCY_STATES.RESERVED
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.COMMIT_CONFLICT,
        `Idempotency key cannot be committed from state ${state}.`,
        {
          state,
        },
        {
          statusCode:
            409,
        },
      );
    }

    if (
      isExpired(
        existing,
        nowMs(
          this.clock,
        ),
      )
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.LEASE_EXPIRED,
        'Idempotency reservation lease has expired.',
        {},
        {
          statusCode:
            409,

          retryable:
            true,
        },
      );
    }

    const committed =
      await this.#atomicCommit(
        normalized,
        existing,
        input.patch ??
          {
            responseSnapshot:
              sanitize(
                input.responseSnapshot ??
                  input.result,
                this.config,
              ),
          },
      );

    this.statistics.commits +=
      1;

    await this.#audit(
      'IDEMPOTENCY_COMMITTED',
      committed,
      {
        semanticMeaning:
          'identity_bound_to_resource_not_settlement',
      },
    );

    await this.#emit(
      'PAYMENT.AIRTEL.DISBURSEMENT.IDEMPOTENCY_COMMITTED',
      committed,
      {
        semanticMeaning:
          'identity_bound_to_resource_not_settlement',
      },
    );

    this.#metric(
      'increment',
      'airtel.disbursement.idempotency.committed.total',
    );

    return deepFreeze({
      committed:
        true,

      existing:
        false,

      replay:
        false,

      idempotent:
        false,

      outcome:
        IDEMPOTENCY_OUTCOMES.COMMITTED,

      state:
        IDEMPOTENCY_STATES.COMMITTED,

      record:
        this.#safeRecord(
          committed,
        ),
    });
  }

  async finalize(
    input = {},
  ) {
    return this.commit(
      input,
    );
  }

  async complete(
    input = {},
  ) {
    return this.commit(
      input,
    );
  }

  async markCommitted(
    input = {},
  ) {
    return this.commit(
      input,
    );
  }

  async release(
    input = {},
  ) {
    const normalized =
      this.#normalize(
        input,
      );

    const existing =
      input.record ??
      (
        await this.#find(
          normalized,
        )
      );

    if (!existing) {
      return deepFreeze({
        released:
          false,

        existing:
          false,

        outcome:
          IDEMPOTENCY_OUTCOMES.RELEASED,

        record:
          null,
      });
    }

    this.#assertTenant(
      existing,
      normalized,
    );

    this.#assertFingerprint(
      existing,
      normalized,
    );

    const state =
      normalizeState(
        existing.state,
      );

    if (
      state ===
      IDEMPOTENCY_STATES.COMMITTED
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.RELEASE_CONFLICT,
        'A committed idempotency identity cannot be released.',
        {},
        {
          statusCode:
            409,
        },
      );
    }

    if (
      state ===
      IDEMPOTENCY_STATES.RELEASED
    ) {
      return deepFreeze({
        released:
          false,

        existing:
          true,

        outcome:
          IDEMPOTENCY_OUTCOMES.RELEASED,

        record:
          this.#safeRecord(
            existing,
          ),
      });
    }

    if (
      state !==
      IDEMPOTENCY_STATES.RESERVED
    ) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.RELEASE_CONFLICT,
        `Idempotency key cannot be released from state ${state}.`,
        {
          state,
        },
        {
          statusCode:
            409,
        },
      );
    }

    const released =
      await this.#atomicRelease(
        normalized,
        existing,
        input.reason ??
          'Reservation released before financial execution.',
      );

    this.statistics.releases +=
      1;

    await this.#audit(
      'IDEMPOTENCY_RELEASED',
      released,
    );

    await this.#emit(
      'PAYMENT.AIRTEL.DISBURSEMENT.IDEMPOTENCY_RELEASED',
      released,
    );

    return deepFreeze({
      released:
        true,

      existing:
        true,

      outcome:
        IDEMPOTENCY_OUTCOMES.RELEASED,

      state:
        IDEMPOTENCY_STATES.RELEASED,

      record:
        this.#safeRecord(
          released,
        ),
    });
  }

  async rollback(
    input = {},
  ) {
    return this.release(
      input,
    );
  }

  async unlock(
    input = {},
  ) {
    return this.release(
      input,
    );
  }

  async get(
    input = {},
  ) {
    const normalized =
      this.#normalize(
        input,
      );

    const existing =
      await this.#find(
        normalized,
      );

    if (!existing) {
      return null;
    }

    this.#assertTenant(
      existing,
      normalized,
    );

    this.#assertFingerprint(
      existing,
      normalized,
    );

    return deepFreeze(
      this.#safeRecord(
        existing,
      ),
    );
  }

  async find(
    input = {},
  ) {
    return this.get(
      input,
    );
  }

  async findByKey(
    input = {},
  ) {
    return this.get(
      input,
    );
  }

  async assertSameRequest(
    input = {},
  ) {
    const normalized =
      this.#normalize(
        input,
      );

    const existing =
      await this.#find(
        normalized,
      );

    if (!existing) {
      return {
        exists:
          false,

        sameRequest:
          false,
      };
    }

    this.#assertTenant(
      existing,
      normalized,
    );

    this.#assertFingerprint(
      existing,
      normalized,
    );

    return {
      exists:
        true,

      sameRequest:
        true,

      state:
        normalizeState(
          existing.state,
        ),

      record:
        this.#safeRecord(
          existing,
        ),
    };
  }

  async isReplay(
    input = {},
  ) {
    const normalized =
      this.#normalize(
        input,
      );

    const existing =
      await this.#find(
        normalized,
      );

    if (!existing) {
      return false;
    }

    this.#assertTenant(
      existing,
      normalized,
    );

    this.#assertFingerprint(
      existing,
      normalized,
    );

    return (
      normalizeState(
        existing.state,
      ) ===
      IDEMPOTENCY_STATES.COMMITTED
    );
  }

  async expire(
    input = {},
  ) {
    const normalized =
      this.#normalize(
        input,
      );

    const existing =
      input.record ??
      (
        await this.#find(
          normalized,
        )
      );

    if (!existing) {
      return null;
    }

    this.#assertTenant(
      existing,
      normalized,
    );

    this.#assertFingerprint(
      existing,
      normalized,
    );

    const fn =
      this.#repo(
        'expireAtomically',
        'atomicExpire',
        'expire',
      );

    if (!fn) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.ATOMIC_OPERATION_REQUIRED,
        'Repository does not expose an atomic expiration operation.',
        {},
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const expired =
      extractRecord(
        await fn({
          ...this.#scope(
            normalized,
          ),

          idempotencyKey:
            normalized.key,

          expectedState:
            IDEMPOTENCY_STATES.RESERVED,

          expectedVersion:
            Number(
              existing.version ??
                1,
            ),

          expectedFingerprint:
            normalized.fingerprint,

          patch: {
            state:
              IDEMPOTENCY_STATES.EXPIRED,

            expiredAt:
              nowIso(
                this.clock,
              ),

            updatedAt:
              nowIso(
                this.clock,
              ),

            version:
              Number(
                existing.version ??
                  1,
              ) + 1,
          },
        }),
      );

    if (!expired) {
      this.#throw(
        IDEMPOTENCY_REASON_CODES.STALE_VERSION,
        'Idempotency expiration lost an optimistic-concurrency race.',
        {},
        {
          statusCode:
            409,
        },
      );
    }

    await this.#audit(
      'IDEMPOTENCY_EXPIRED',
      expired,
    );

    await this.#emit(
      'PAYMENT.AIRTEL.DISBURSEMENT.IDEMPOTENCY_EXPIRED',
      expired,
    );

    return deepFreeze({
      expired:
        true,

      outcome:
        IDEMPOTENCY_OUTCOMES.EXPIRED,

      state:
        IDEMPOTENCY_STATES.EXPIRED,

      record:
        this.#safeRecord(
          expired,
        ),
    });
  }

  health() {
    const dependencies = {
      repository:
        Boolean(
          this.repository,
        ),

      atomicReserve:
        Boolean(
          this.#repo(
            'reserveAtomically',
            'atomicReserve',
            'createIfAbsent',
            'insertIfAbsent',
            'reserve',
            'create',
          ),
        ),

      atomicCommit:
        Boolean(
          this.#repo(
            'commitAtomically',
            'atomicCommit',
            'commit',
            'finalize',
            'complete',
            'markCommitted',
          ),
        ),

      atomicRelease:
        Boolean(
          this.#repo(
            'releaseAtomically',
            'atomicRelease',
            'release',
            'rollback',
            'unlock',
          ),
        ),

      audit:
        Boolean(
          this.auditService,
        ),

      events:
        Boolean(
          this.eventBus,
        ),
    };

    const healthy =
      dependencies.repository &&
      dependencies.atomicReserve &&
      dependencies.atomicCommit &&
      dependencies.atomicRelease;

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      version:
        ENGINE_VERSION,

      healthy,

      status:
        healthy
          ? 'UP'
          : 'DEGRADED',

      dependencies,

      controls: {
        tenantIsolation:
          this.config
            .requireTenantId,

        originalIdempotencyRequired:
          this.config
            .requireOriginalIdempotencyKey,

        fingerprintRequired:
          this.config
            .requireRequestFingerprint,

        atomicRepositoryRequired:
          this.config
            .requireAtomicRepository,

        releasedReuse:
          this.config
            .allowReleasedReuse,

        reclaimExpiredReservations:
          this.config
            .reclaimExpiredReservations,
      },

      statistics:
        this.getStatistics(),
    });
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

      atomicReserve:
        true,

      atomicCommit:
        true,

      atomicRelease:
        true,

      leaseSupport:
        true,

      expiredReclaim:
        this.config
          .reclaimExpiredReservations,

      releasedReuse:
        this.config
          .allowReleasedReuse,

      originalIdempotencyPreserved:
        true,

      retryCreatesNewFinancialIdentity:
        false,

      directProviderCall:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      settlementFinality:
        false,
    });
  }

  getStatistics() {
    return deepFreeze({
      ...this.statistics,
    });
  }

  resetStatistics() {
    this.statistics = {
      reserveAttempts:
        0,

      reservations:
        0,

      replays:
        0,

      conflicts:
        0,

      commits:
        0,

      releases:
        0,

      reclaimAttempts:
        0,

      reclaimSuccesses:
        0,

      failures:
        0,
    };
  }
}

export const createIdempotencyManager = (
  options = {},
) =>
  new AirtelIdempotencyManager(
    options,
  );

export const createAirtelIdempotencyManager =
  createIdempotencyManager;

export const AirtelDisbursementIdempotencyManager =
  AirtelIdempotencyManager;

export const IdempotencyManager =
  AirtelIdempotencyManager;

export const defaultIdempotencyManager =
  createIdempotencyManager();

export const idempotencyManager =
  defaultIdempotencyManager;

export default AirtelIdempotencyManager;

// Keep the dependency used by the canonical constants module visible to bundlers
// and static analyzers without introducing runtime side effects.
export const IDEMPOTENCY_TTL_DEFAULT_MS =
  TTL_POLICY_MS.approvalDefault *
  96;