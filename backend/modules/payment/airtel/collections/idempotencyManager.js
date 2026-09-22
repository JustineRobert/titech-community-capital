'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collection Idempotency Manager
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/collections/idempotencyManager.js
 *
 * Architectural role
 * ------------------
 * Canonical financial-identity and idempotency boundary for Airtel inbound
 * COLLECTION operations. The manager binds one tenant-scoped original
 * idempotency key to one immutable collection intent and provides atomic
 * reserve/commit/replay/release semantics to collectionService.js, workers,
 * callback handlers and recovery workflows.
 *
 * Canonical identity
 * ------------------
 *   tenant + provider + operation + originalIdempotencyKey
 *
 *   semantic request fingerprint
 *             |
 *             v
 *   RESERVE -> IN_FLIGHT -> COMMITTED -> REPLAY
 *       |         |             |
 *       |         +-- lease ----+
 *       |              expiry
 *       v
 *    RELEASED -> safe pre-execution reuse only
 *
 * Responsibilities
 * ----------------
 * - Require and normalize original collection idempotency identity.
 * - Scope all records by tenant/provider/operation/key.
 * - Detect semantic fingerprint conflicts.
 * - Atomically reserve an identity before durable processing.
 * - Detect duplicate/replay requests without executing a second collection.
 * - Maintain reservation leases and controlled expiry/reclaim semantics.
 * - Commit a key to a canonical collection resource and optional replay response.
 * - Release a reservation only when doing so is explicitly safe.
 * - Support atomic compare-and-set persistence through injected repository
 *   methods, while remaining storage-agnostic.
 * - Emit privacy-preserving audit/event/metrics evidence.
 * - Preserve original collection identity across provider retries and recovery.
 *
 * Explicit non-responsibilities
 * -----------------------------
 * - No Airtel API calls.
 * - No provider credentials/tokens.
 * - No ledger/journal writes.
 * - No balance/wallet mutation.
 * - No authorization or maker-checker approval.
 * - No KYC/AML/fraud adjudication.
 * - No reconciliation/finality.
 * - No automatic creation of a replacement financial identity.
 * - No direct MongoDB/Redis access.
 * - No interpretation of COMMITTED as payment settlement.
 *
 * Financial-safety principles
 * ---------------------------
 * 1. The original idempotency key is immutable for the financial intent.
 * 2. A different fingerprint with the same key is always CONFLICT.
 * 3. Concurrent reservations are resolved by authoritative atomic storage,
 *    not process-local timing.
 * 4. COMMITTED binds identity to a resource; it does not assert settlement.
 * 5. An active lease is not stolen by a new caller.
 * 6. Reclaim is allowed only after an atomic lease-expiry check and only before
 *    financial execution is known to have become ambiguous.
 * 7. Unknown/ambiguous provider outcomes do not release or replace identity.
 * 8. Raw idempotency keys are never written to audit/events/logs.
 * 9. The cache is an optimization only; authoritative persistence remains the
 *    source of truth.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'COLLECTION';
export const MODULE_NAME = 'titech.airtel.collections.idempotency';
export const ENGINE_NAME = 'airtel-collection-idempotency-manager';
export const ENGINE_VERSION = '4.0.0';
export const COMPONENT = ENGINE_NAME;
export const SCHEMA_VERSION = 4;
export const HASH_ALGORITHM = 'sha256';

export const IDEMPOTENCY_STATES = Object.freeze({
  RESERVED: 'RESERVED',
  IN_FLIGHT: 'IN_FLIGHT',
  COMMITTED: 'COMMITTED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
});

export const IDEMPOTENCY_OUTCOMES = Object.freeze({
  RESERVED: 'RESERVED',
  ALREADY_RESERVED: 'ALREADY_RESERVED',
  IN_FLIGHT: 'IN_FLIGHT',
  COMMITTED: 'COMMITTED',
  REPLAY: 'REPLAY',
  CONFLICT: 'CONFLICT',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
  RECLAIMED: 'RECLAIMED',
  FAILED: 'FAILED',
});

export const IDEMPOTENCY_DECISIONS = Object.freeze({
  CONTINUE: 'CONTINUE',
  REPLAY: 'REPLAY',
  CONFLICT: 'CONFLICT',
  IN_FLIGHT: 'IN_FLIGHT',
  STOP: 'STOP',
});

export const ACTIONS = Object.freeze({
  RESERVE: 'RESERVE',
  CLAIM: 'CLAIM',
  COMMIT: 'COMMIT',
  RELEASE: 'RELEASE',
  EXPIRE: 'EXPIRE',
  RECLAIM: 'RECLAIM',
  GET: 'GET',
});

export const FINANCIAL_BOUNDARY = Object.freeze({
  providerCalls: false,
  ledgerWrites: false,
  balanceMutation: false,
  walletMutation: false,
  settlementFinality: false,
  authoritativeBoundary: 'TITECH_FINANCIAL_CORE',
});

export const DEFAULT_CONFIGURATION = Object.freeze({
  requireTenantId: true,
  requireProvider: true,
  requireOperation: true,
  requireKey: true,
  requireFingerprint: true,
  requireResourceIdOnCommit: true,
  requireAtomicRepository: true,
  allowInMemoryStore: false,
  reservationLeaseSeconds: 120,
  committedTtlSeconds: 86400,
  releasedRetentionSeconds: 86400,
  expiredRetentionSeconds: 3600,
  maxKeyLength: 256,
  maxTenantIdLength: 160,
  maxResourceIdLength: 256,
  maxFingerprintLength: 128,
  maxResponseBytes: 256 * 1024,
  maxMetadataKeys: 50,
  maxMetadataDepth: 5,
  maxMetadataStringLength: 512,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
});

export const CAPABILITIES = Object.freeze({
  tenantScoped: true,
  providerScoped: true,
  operationScoped: true,
  semanticFingerprinting: true,
  atomicReserve: true,
  atomicCommit: true,
  atomicRelease: true,
  atomicReclaim: true,
  replayProtection: true,
  conflictProtection: true,
  leaseProtection: true,
  providerCommunication: false,
  ledgerMutation: false,
  balanceMutation: false,
  walletMutation: false,
  settlementFinality: false,
});

export class AirtelCollectionIdempotencyError extends Error {
  constructor(message, {
    code = 'AIRTEL_COLLECTION_IDEMPOTENCY_ERROR',
    statusCode = 500,
    retryable = false,
    tenantId = null,
    correlationId = null,
    operationId = null,
    details = {},
    cause = undefined,
  } = {}) {
    super(
      String(
        message ||
        'Airtel collection idempotency error.',
      ),
      cause
        ? { cause }
        : undefined,
    );

    this.name =
      'AirtelCollectionIdempotencyError';

    this.code = code;
    this.statusCode =
      Number(statusCode) || 500;

    this.retryable =
      Boolean(retryable);

    this.tenantId =
      tenantId;

    this.correlationId =
      correlationId;

    this.operationId =
      operationId;

    this.details =
      sanitize(
        details,
        DEFAULT_CONFIGURATION,
      );
  }

  toJSON() {
    return {
      name:
        this.name,

      message:
        this.message,

      code:
        this.code,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      tenantId:
        this.tenantId,

      correlationId:
        this.correlationId,

      operationId:
        this.operationId,

      details:
        this.details,
    };
  }
}

const SENSITIVE_KEY =
  /password|secret|token|authorization|cookie|signature|private.?key|api.?key|credential|otp|pin|cvv|cvc/i;

const UNSAFE_KEYS =
  new Set([
    '__proto__',
    'prototype',
    'constructor',
  ]);

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) ===
      Object.prototype,
  );
}

function isFunction(value) {
  return (
    typeof value ===
    'function'
  );
}

function bounded(
  value,
  max,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const s =
    String(value).trim();

  return s
    ? s.slice(
        0,
        max,
      )
    : null;
}

function upper(value) {
  const s =
    bounded(
      value,
      256,
    );

  return s
    ? s.toUpperCase()
    : null;
}

function stable(
  value,
  depth = 0,
) {
  if (
    depth > 8
  ) {
    return '[MAX_DEPTH]';
  }

  if (
    value === undefined
  ) {
    return '[undefined]';
  }

  if (
    value === null
  ) {
    return null;
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
      (v) =>
        stable(
          v,
          depth + 1,
        ),
    );
  }

  if (
    !isPlainObject(value)
  ) {
    return typeof value ===
      'bigint'
      ? value.toString()
      : value;
  }

  return Object.keys(value)
    .filter(
      (key) =>
        !UNSAFE_KEYS.has(
          key,
        ),
    )
    .sort()
    .reduce(
      (
        out,
        key,
      ) => {
        out[key] =
          stable(
            value[key],
            depth + 1,
          );

        return out;
      },
      {},
    );
}

function sha256(value) {
  return createHash(
    HASH_ALGORITHM,
  )
    .update(
      typeof value ===
        'string'
        ? value
        : JSON.stringify(
            stable(value),
          ),
      'utf8',
    )
    .digest('hex');
}

function sanitize(
  value,
  config =
    DEFAULT_CONFIGURATION,
  depth = 0,
  seen =
    new WeakSet(),
) {
  if (
    value ===
      undefined ||
    value === null
  ) {
    return value;
  }

  if (
    depth >
    config.maxMetadataDepth
  ) {
    return '[TRUNCATED]';
  }

  if (
    typeof value ===
    'string'
  ) {
    return value.slice(
      0,
      config.maxMetadataStringLength,
    );
  }

  if (
    typeof value ===
      'number' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return value.toString();
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    typeof value !==
      'object'
  ) {
    return undefined;
  }

  if (
    seen.has(value)
  ) {
    return '[CIRCULAR]';
  }

  seen.add(value);

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        100,
      )
      .map(
        (v) =>
          sanitize(
            v,
            config,
            depth + 1,
            seen,
          ),
      );
  }

  const out = {};

  for (
    const key of Object.keys(
      value,
    ).slice(
      0,
      config.maxMetadataKeys,
    )
  ) {
    if (
      UNSAFE_KEYS.has(key)
    ) {
      continue;
    }

    if (
      SENSITIVE_KEY.test(
        key,
      )
    ) {
      out[key] =
        '[REDACTED]';

      continue;
    }

    out[key] =
      sanitize(
        value[key],
        config,
        depth + 1,
        seen,
      );
  }

  return out;
}

function clone(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  return JSON.parse(
    JSON.stringify(
      value,
    ),
  );
}

function normalizeFingerprint(
  value,
  maxLength,
) {
  const normalized =
    bounded(
      value,
      maxLength,
    );

  if (!normalized) {
    return null;
  }

  return /^[a-f0-9]{64}$/i.test(
    normalized,
  )
    ? normalized.toLowerCase()
    : sha256(
        normalized,
      );
}

function normalizeKey(
  value,
  maxLength,
) {
  return bounded(
    value,
    maxLength,
  );
}

function parsePositiveInteger(
  value,
  fallback,
) {
  const n =
    Number(value);

  return (
    Number.isInteger(n) &&
    n > 0
  )
    ? n
    : fallback;
}

function safeDate(value) {
  const d =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(value);

  return Number.isNaN(
    d.getTime(),
  )
    ? null
    : d;
}

function isDuplicateError(
  error,
) {
  const text =
    `${error?.code || ''} ` +
    `${error?.codeName || ''} ` +
    `${error?.name || ''} ` +
    `${error?.message || ''}`;

  return /E11000|DUPLICATE|ALREADY_EXISTS|ALREADY EXISTS|UNIQUE/i.test(
    text,
  );
}

function isLeaseExpired(
  record,
  at = Date.now(),
) {
  const lease =
    safeDate(
      record?.leaseExpiresAt,
    );

  return Boolean(
    lease &&
    lease.getTime() <= at,
  );
}

function responseByteLength(
  value,
) {
  if (
    value === undefined
  ) {
    return 0;
  }

  try {
    return Buffer.byteLength(
      JSON.stringify(
        value,
      ),
      'utf8',
    );
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function mergeConfiguration(
  input = {},
) {
  return {
    ...DEFAULT_CONFIGURATION,
    ...(input || {}),
  };
}

export class AirtelCollectionIdempotencyManager {
  constructor({
    repository = null,
    idempotencyRepository = null,
    store = null,
    auditService = null,
    audit = null,
    eventBus = null,
    eventPublisher = null,
    outbox = null,
    metrics = null,
    logger = console,
    clock = Date,
    idFactory = () =>
      `idem_${randomUUID()}`,
    configuration = {},
    config = {},
  } = {}) {
    this.repository =
      repository ||
      idempotencyRepository ||
      store ||
      null;

    this.auditService =
      auditService ||
      audit ||
      null;

    this.eventBus =
      eventBus ||
      eventPublisher ||
      outbox ||
      null;

    this.metrics =
      metrics ||
      null;

    this.logger =
      logger ||
      console;

    this.clock =
      clock ||
      Date;

    this.idFactory =
      idFactory ||
      (() =>
        `idem_${randomUUID()}`);

    this.config =
      Object.freeze(
        mergeConfiguration(
          configuration ||
            config,
        ),
      );

    this.local =
      new Map();

    this.statistics = {
      reservations: 0,
      alreadyReserved: 0,
      inFlight: 0,
      commits: 0,
      replays: 0,
      conflicts: 0,
      releases: 0,
      expirations: 0,
      reclaims: 0,
      failed: 0,
      persistenceRaces: 0,
      auditFailures: 0,
      eventFailures: 0,
    };
  }

  #now() {
    try {
      const value =
        typeof this.clock ===
        'function'
          ? this.clock()
          : this.clock.now();

      if (
        value instanceof Date
      ) {
        return value.getTime();
      }

      const numeric =
        Number(value);

      return Number.isFinite(
        numeric,
      )
        ? numeric
        : Date.now();
    } catch {
      return Date.now();
    }
  }

  #scope({
    tenantId,
    provider = PROVIDER,
    operation = OPERATION,
  }) {
    const tenant =
      bounded(
        tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (
      this.config
        .requireTenantId &&
      !tenant
    ) {
      throw new AirtelCollectionIdempotencyError(
        'Tenant context is required.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_TENANT_REQUIRED',

          statusCode:
            400,
        },
      );
    }

    const p =
      upper(
        provider,
      );

    const o =
      upper(
        operation,
      );

    if (
      this.config
        .requireProvider &&
      p !== PROVIDER
    ) {
      throw new AirtelCollectionIdempotencyError(
        'Idempotency manager is scoped to Airtel.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_PROVIDER_INVALID',

          statusCode:
            409,

          tenantId:
            tenant,
        },
      );
    }

    if (
      this.config
        .requireOperation &&
      o !== OPERATION
    ) {
      throw new AirtelCollectionIdempotencyError(
        'Idempotency manager is scoped to collection operations.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_OPERATION_INVALID',

          statusCode:
            409,

          tenantId:
            tenant,
        },
      );
    }

    return {
      tenantId:
        tenant,

      provider:
        p,

      operation:
        o,
    };
  }

  #normalizeInput(
    input = {},
    {
      requireResourceId =
        false,
    } = {},
  ) {
    const scope =
      this.#scope(
        input,
      );

    const key =
      normalizeKey(
        input
          .originalIdempotencyKey ??
          input.idempotencyKey ??
          input.key,

        this.config
          .maxKeyLength,
      );

    if (
      this.config.requireKey &&
      !key
    ) {
      throw new AirtelCollectionIdempotencyError(
        'Original idempotency key is required.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_KEY_REQUIRED',

          statusCode:
            400,

          tenantId:
            scope.tenantId,

          correlationId:
            input.correlationId,

          operationId:
            input.operationId,
        },
      );
    }

    const fingerprint =
      normalizeFingerprint(
        input.requestFingerprint ??
          input.financialFingerprint ??
          input.fingerprint,

        this.config
          .maxFingerprintLength,
      );

    if (
      this.config
        .requireFingerprint &&
      !fingerprint
    ) {
      throw new AirtelCollectionIdempotencyError(
        'A semantic request fingerprint is required.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_FINGERPRINT_REQUIRED',

          statusCode:
            400,

          tenantId:
            scope.tenantId,

          correlationId:
            input.correlationId,

          operationId:
            input.operationId,
        },
      );
    }

    const resourceId =
      bounded(
        input.resourceId ??
          input.collectionId ??
          input.paymentId ??
          input.transactionId,

        this.config
          .maxResourceIdLength,
      );

    if (
      requireResourceId &&
      this.config
        .requireResourceIdOnCommit &&
      !resourceId
    ) {
      throw new AirtelCollectionIdempotencyError(
        'Canonical collection resourceId is required for commit.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_RESOURCE_REQUIRED',

          statusCode:
            400,

          tenantId:
            scope.tenantId,

          correlationId:
            input.correlationId,

          operationId:
            input.operationId,
        },
      );
    }

    return {
      ...scope,

      key,

      fingerprint,

      resourceId,

      resourceType:
        bounded(
          input.resourceType ??
            'AIRTEL_COLLECTION',
          120,
        ),

      correlationId:
        bounded(
          input.correlationId,
          160,
        ),

      operationId:
        bounded(
          input.operationId,
          160,
        ),

      actorId:
        bounded(
          input.actorId ??
            input.actor?.actorId,
          160,
        ),

      metadata:
        sanitize(
          input.metadata ??
            {},
          this.config,
        ),

      response:
        this.#boundedResponse(
          input.response,
        ),

      reservationId:
        bounded(
          input.reservationId,
          160,
        ),

      leaseSeconds:
        parsePositiveInteger(
          input.leaseSeconds,
          this.config
            .reservationLeaseSeconds,
        ),

      ttlSeconds:
        parsePositiveInteger(
          input.ttlSeconds,
          this.config
            .committedTtlSeconds,
        ),

      at:
        safeDate(
          input.at,
        ) ||
        new Date(
          this.#now(),
        ),

      token:
        bounded(
          input.reservationToken ??
            input.leaseToken ??
            input.token,
          160,
        ),
    };
  }

  #boundedResponse(
    response,
  ) {
    if (
      response ===
        undefined ||
      response === null
    ) {
      return undefined;
    }

    if (
      responseByteLength(
        response,
      ) <=
      this.config.maxResponseBytes
    ) {
      return sanitize(
        response,
        this.config,
      );
    }

    return {
      _truncated:
        true,

      fingerprint:
        sha256(
          response,
        ),

      byteLength:
        responseByteLength(
          response,
        ),
    };
  }

  #key(
    scope,
    key,
  ) {
    return (
      `${scope.tenantId}:` +
      `${scope.provider}:` +
      `${scope.operation}:` +
      `${key}`
    );
  }

  #cacheRead(
    identity,
  ) {
    const composite =
      this.#key(
        identity,
        identity.key,
      );

    const record =
      this.local.get(
        composite,
      );

    if (!record) {
      return null;
    }

    if (
      record.expiresAt &&
      record.expiresAt <=
        this.#now()
    ) {
      this.local.delete(
        composite,
      );

      return null;
    }

    return clone(
      record,
    );
  }

  #cacheWrite(
    record,
  ) {
    const composite =
      this.#key(
        record,
        record.key,
      );

    this.local.set(
      composite,
      clone(
        record,
      ),
    );
  }

  #cacheDelete(
    identity,
  ) {
    this.local.delete(
      this.#key(
        identity,
        identity.key,
      ),
    );
  }

  #repositoryHasAtomic(
    methods,
  ) {
    if (
      !this.repository
    ) {
      return false;
    }

    return methods.some(
      (name) =>
        isFunction(
          this.repository?.[
            name
          ],
        ),
    );
  }

  async #repositoryCall(
    methods,
    payload,
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
        return {
          called:
            true,

          method,

          value:
            await this.repository[
              method
            ](
              payload,
            ),
        };
      }
    }

    return {
      called:
        false,

      method:
        null,

      value:
        undefined,
    };
  }

  #requireAtomic(
    methods,
    tenantId,
    correlationId,
    operationId,
  ) {
    if (
      this.#repositoryHasAtomic(
        methods,
      )
    ) {
      return;
    }

    if (
      this.config
        .allowInMemoryStore
    ) {
      return;
    }

    throw new AirtelCollectionIdempotencyError(
      'An atomic idempotency repository contract is required.',
      {
        code:
          'AIRTEL_COLLECTION_IDEMPOTENCY_ATOMIC_STORE_REQUIRED',

        statusCode:
          503,

        retryable:
          true,

        tenantId,

        correlationId,

        operationId,

        details: {
          acceptedMethods:
            methods,
        },
      },
    );
  }

  async reserve(
    input = {},
  ) {
    const identity =
      this.#normalizeInput(
        input,
      );

    const now =
      identity.at;

    const leaseExpiresAt =
      new Date(
        now.getTime() +
          identity.leaseSeconds *
            1000,
      );

    this.#requireAtomic(
      [
        'reserveIfAbsent',
        'reserve',
        'createIfAbsent',
        'claimIfAbsent',
        'atomicReserve',
      ],

      identity.tenantId,
      identity.correlationId,
      identity.operationId,
    );

    const existing =
      await this.get(
        {
          ...identity,

          includeExpired:
            true,
        },
      );

    if (existing) {
      const fingerprintMatches =
        existing.fingerprint ===
        identity.fingerprint;

      if (
        !fingerprintMatches
      ) {
        this.statistics
          .conflicts +=
          1;

        this.#metric(
          'increment',
          'titech_airtel_collection_idempotency_conflict_total',
        );

        return this.#result(
          identity,
          {
            outcome:
              IDEMPOTENCY_OUTCOMES.CONFLICT,

            decision:
              IDEMPOTENCY_DECISIONS.CONFLICT,

            conflict:
              true,

            reserved:
              false,

            replay:
              false,

            existing:
              this.#publicRecord(
                existing,
              ),

            reason:
              'The idempotency key is already bound to a different semantic collection request.',
          },
        );
      }

      if (
        existing.state ===
        IDEMPOTENCY_STATES.COMMITTED
      ) {
        this.statistics
          .replays +=
          1;

        return this.#result(
          identity,
          {
            outcome:
              IDEMPOTENCY_OUTCOMES.REPLAY,

            decision:
              IDEMPOTENCY_DECISIONS.REPLAY,

            committed:
              true,

            replay:
              true,

            existing:
              this.#publicRecord(
                existing,
              ),

            response:
              existing.response,

            resourceId:
              existing.resourceId,

            reason:
              'The collection idempotency identity is already committed.',
          },
        );
      }

      if (
        [
          IDEMPOTENCY_STATES.RESERVED,
          IDEMPOTENCY_STATES.IN_FLIGHT,
        ].includes(
          existing.state,
        ) &&
        !isLeaseExpired(
          existing,
          now.getTime(),
        )
      ) {
        this.statistics
          .alreadyReserved +=
          1;

        this.statistics
          .inFlight +=
          1;

        return this.#result(
          identity,
          {
            outcome:
              existing.state ===
              IDEMPOTENCY_STATES.IN_FLIGHT
                ? IDEMPOTENCY_OUTCOMES.IN_FLIGHT
                : IDEMPOTENCY_OUTCOMES.ALREADY_RESERVED,

            decision:
              IDEMPOTENCY_DECISIONS.IN_FLIGHT,

            reserved:
              false,

            alreadyReserved:
              true,

            inFlight:
              true,

            reservationId:
              existing.reservationId,

            existing:
              this.#publicRecord(
                existing,
              ),

            reason:
              'The collection idempotency identity is currently owned by another active reservation.',
          },
        );
      }
    }

    const candidate = {
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        identity.tenantId,

      key:
        identity.key,

      fingerprint:
        identity.fingerprint,

      resourceId:
        identity.resourceId,

      resourceType:
        identity.resourceType,

      state:
        IDEMPOTENCY_STATES.RESERVED,

      reservationId:
        identity.reservationId ||
        this.idFactory(),

      reservationToken:
        identity.token ||
        this.idFactory(),

      leaseExpiresAt,

      expiresAt:
        new Date(
          now.getTime() +
            identity.ttlSeconds *
              1000,
        ),

      attempts:
        Number(
          existing?.attempts ||
            0,
        ) +
        1,

      correlationId:
        identity.correlationId,

      operationId:
        identity.operationId,

      actorId:
        identity.actorId,

      metadata:
        identity.metadata,

      response:
        undefined,

      createdAt:
        existing?.createdAt ||
        now,

      updatedAt:
        now,

      stateVersion:
        Number(
          existing?.stateVersion ||
            0,
        ) +
        1,
    };

    let persisted;

    if (
      this.repository
    ) {
      try {
        const call =
          await this.#repositoryCall(
            [
              'reserveIfAbsent',
              'reserve',
              'createIfAbsent',
              'claimIfAbsent',
              'atomicReserve',
            ],

            candidate,
          );

        persisted =
          call.called
            ? call.value
            : undefined;
      } catch (error) {
        if (
          isDuplicateError(
            error,
          )
        ) {
          this.statistics
            .persistenceRaces +=
            1;

          const raced =
            await this.get(
              identity,
            );

          if (
            raced &&
            raced.fingerprint !==
              identity.fingerprint
          ) {
            this.statistics
              .conflicts +=
              1;

            return this.#result(
              identity,
              {
                outcome:
                  IDEMPOTENCY_OUTCOMES.CONFLICT,

                decision:
                  IDEMPOTENCY_DECISIONS.CONFLICT,

                conflict:
                  true,

                existing:
                  this.#publicRecord(
                    raced,
                  ),
              },
            );
          }

          if (
            raced?.state ===
            IDEMPOTENCY_STATES.COMMITTED
          ) {
            this.statistics
              .replays +=
              1;

            return this.#result(
              identity,
              {
                outcome:
                  IDEMPOTENCY_OUTCOMES.REPLAY,

                decision:
                  IDEMPOTENCY_DECISIONS.REPLAY,

                replay:
                  true,

                committed:
                  true,

                existing:
                  this.#publicRecord(
                    raced,
                  ),

                response:
                  raced.response,

                resourceId:
                  raced.resourceId,
              },
            );
          }

          if (
            raced &&
            [
              IDEMPOTENCY_STATES.RELEASED,
              IDEMPOTENCY_STATES.EXPIRED,
            ].includes(
              raced.state,
            )
          ) {
            const reusable =
              await this.#reclaimReleased(
                identity,
                raced,
              );

            if (reusable) {
              this.#cacheWrite(
                reusable,
              );

              this.statistics
                .reclaims +=
                1;

              return this.#result(
                identity,
                {
                  outcome:
                    IDEMPOTENCY_OUTCOMES.RECLAIMED,

                  decision:
                    IDEMPOTENCY_DECISIONS.CONTINUE,

                  reserved:
                    true,

                  reclaimed:
                    true,

                  reservationId:
                    reusable.reservationId,

                  reservationToken:
                    reusable.reservationToken,

                  leaseExpiresAt:
                    reusable.leaseExpiresAt,

                  expiresAt:
                    reusable.expiresAt,

                  record:
                    this.#publicRecord(
                      reusable,
                    ),
                },
              );
            }
          }

          this.statistics
            .alreadyReserved +=
            1;

          return this.#result(
            identity,
            {
              outcome:
                IDEMPOTENCY_OUTCOMES.ALREADY_RESERVED,

              decision:
                IDEMPOTENCY_DECISIONS.IN_FLIGHT,

              inFlight:
                true,

              alreadyReserved:
                true,

              existing:
                this.#publicRecord(
                  raced,
                ),

              reservationId:
                raced?.reservationId,
            },
          );
        }

        this.statistics
          .failed +=
          1;

        throw new AirtelCollectionIdempotencyError(
          'Idempotency reservation failed.',
          {
            code:
              'AIRTEL_COLLECTION_IDEMPOTENCY_RESERVE_FAILED',

            statusCode:
              503,

            retryable:
              true,

            tenantId:
              identity.tenantId,

            correlationId:
              identity.correlationId,

            operationId:
              identity.operationId,

            cause:
              error,
          },
        );
      }
    } else {
      persisted =
        candidate;
    }

    const record =
      this.#recordFromPersistence(
        persisted,
        candidate,
      );

    if (
      record.fingerprint !==
      identity.fingerprint
    ) {
      this.statistics
        .conflicts +=
        1;

      throw new AirtelCollectionIdempotencyError(
        'Repository returned a conflicting fingerprint.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_PERSISTED_FINGERPRINT_CONFLICT',

          statusCode:
            409,

          tenantId:
            identity.tenantId,

          correlationId:
            identity.correlationId,

          operationId:
            identity.operationId,
        },
      );
    }

    this.#cacheWrite(
      record,
    );

    this.statistics
      .reservations +=
      1;

    const result =
      this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.RESERVED,

          decision:
            IDEMPOTENCY_DECISIONS.CONTINUE,

          reserved:
            true,

          reservationId:
            record.reservationId,

          reservationToken:
            record.reservationToken,

          state:
            record.state,

          expiresAt:
            record.expiresAt,

          leaseExpiresAt:
            record.leaseExpiresAt,

          record:
            this.#publicRecord(
              record,
            ),
        },
      );

    await this.#audit(
      result,
      ACTIONS.RESERVE,
    );

    await this.#emit(
      result,
      'AIRTEL_COLLECTION_IDEMPOTENCY_RESERVED',
    );

    this.#metric(
      'increment',
      'titech_airtel_collection_idempotency_reserved_total',
    );

    return result;
  }

  async #reclaimReleased(
    identity,
    existing,
  ) {
    const candidate = {
      ...existing,

      tenantId:
        identity.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      key:
        identity.key,

      fingerprint:
        identity.fingerprint,

      resourceId:
        identity.resourceId ||
        existing.resourceId ||
        null,

      resourceType:
        identity.resourceType ||
        existing.resourceType ||
        'AIRTEL_COLLECTION',

      state:
        IDEMPOTENCY_STATES.RESERVED,

      reservationId:
        this.idFactory(),

      reservationToken:
        identity.token ||
        this.idFactory(),

      leaseExpiresAt:
        new Date(
          identity.at.getTime() +
            identity.leaseSeconds *
              1000,
        ),

      expiresAt:
        new Date(
          identity.at.getTime() +
            identity.ttlSeconds *
              1000,
        ),

      updatedAt:
        identity.at,

      stateVersion:
        Number(
          existing.stateVersion ||
            0,
        ) +
        1,

      reclaimCount:
        Number(
          existing.reclaimCount ||
            0,
        ) +
        1,

      reclaimedAt:
        identity.at,
    };

    if (!this.repository) {
      if (
        this.config
          .allowInMemoryStore
      ) {
        return candidate;
      }

      return null;
    }

    const call =
      await this.#repositoryCall(
        [
          'reclaimReleased',
          'reclaimReleasedIfOwner',
          'reuseReleased',
          'reuseIfReleased',
          'reclaimExpired',
          'reclaimIfExpired',
        ],

        candidate,
      );

    if (
      !call.called
    ) {
      return null;
    }

    if (
      !call.value
    ) {
      return null;
    }

    return this.#recordFromPersistence(
      call.value.record ||
        call.value,
      candidate,
    );
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
    const identity =
      this.#normalizeInput(
        input,
        {
          requireResourceId:
            true,
        },
      );

    this.#requireAtomic(
      [
        'commitIfOwner',
        'commit',
        'finalize',
        'complete',
        'markCommitted',
        'atomicCommit',
      ],

      identity.tenantId,
      identity.correlationId,
      identity.operationId,
    );

    const existing =
      await this.get(
        {
          ...identity,
          includeExpired:
            true,
        },
      );

    if (!existing) {
      throw new AirtelCollectionIdempotencyError(
        'Cannot commit an unknown idempotency identity.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_NOT_FOUND',

          statusCode:
            404,

          tenantId:
            identity.tenantId,

          correlationId:
            identity.correlationId,

          operationId:
            identity.operationId,
        },
      );
    }

    if (
      existing.fingerprint !==
      identity.fingerprint
    ) {
      this.statistics
        .conflicts +=
        1;

      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.CONFLICT,

          decision:
            IDEMPOTENCY_DECISIONS.CONFLICT,

          conflict:
            true,

          existing:
            this.#publicRecord(
              existing,
            ),
        },
      );
    }

    if (
      existing.state ===
      IDEMPOTENCY_STATES.COMMITTED
    ) {
      if (
        existing.resourceId &&
        String(
          existing.resourceId,
        ) !==
          String(
            identity.resourceId,
          )
      ) {
        this.statistics
          .conflicts +=
          1;

        return this.#result(
          identity,
          {
            outcome:
              IDEMPOTENCY_OUTCOMES.CONFLICT,

            decision:
              IDEMPOTENCY_DECISIONS.CONFLICT,

            conflict:
              true,

            existing:
              this.#publicRecord(
                existing,
              ),
          },
        );
      }

      this.statistics
        .replays +=
        1;

      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.REPLAY,

          decision:
            IDEMPOTENCY_DECISIONS.REPLAY,

          committed:
            true,

          replay:
            true,

          resourceId:
            existing.resourceId,

          response:
            existing.response,

          existing:
            this.#publicRecord(
              existing,
            ),
        },
      );
    }

    if (
      [
        IDEMPOTENCY_STATES.RESERVED,
        IDEMPOTENCY_STATES.IN_FLIGHT,
      ].includes(
        existing.state,
      ) &&
      !isLeaseExpired(
        existing,
        identity.at.getTime(),
      ) &&
      identity.token &&
      existing.reservationToken &&
      identity.token !==
        existing.reservationToken
    ) {
      throw new AirtelCollectionIdempotencyError(
        'Reservation is owned by another worker.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_RESERVATION_OWNER_CONFLICT',

          statusCode:
            409,

          retryable:
            true,

          tenantId:
            identity.tenantId,

          correlationId:
            identity.correlationId,

          operationId:
            identity.operationId,
        },
      );
    }

    const candidate = {
      ...existing,

      state:
        IDEMPOTENCY_STATES.COMMITTED,

      resourceId:
        identity.resourceId,

      resourceType:
        identity.resourceType,

      response:
        identity.response,

      committedAt:
        identity.at,

      updatedAt:
        identity.at,

      leaseExpiresAt:
        null,

      expiresAt:
        new Date(
          identity.at.getTime() +
            identity.ttlSeconds *
              1000,
        ),

      stateVersion:
        Number(
          existing.stateVersion ||
            0,
        ) +
        1,

      commitCorrelationId:
        identity.correlationId,

      commitOperationId:
        identity.operationId,
    };

    let persisted;

    try {
      if (
        this.repository
      ) {
        const call =
          await this.#repositoryCall(
            [
              'commitIfOwner',
              'commit',
              'finalize',
              'complete',
              'markCommitted',
              'atomicCommit',
            ],

            candidate,
          );

        persisted =
          call.called
            ? call.value
            : undefined;
      } else {
        persisted =
          candidate;
      }
    } catch (error) {
      this.statistics
        .failed +=
        1;

      throw new AirtelCollectionIdempotencyError(
        'Idempotency commit failed.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_COMMIT_FAILED',

          statusCode:
            503,

          retryable:
            true,

          tenantId:
            identity.tenantId,

          correlationId:
            identity.correlationId,

          operationId:
            identity.operationId,

          cause:
            error,
        },
      );
    }

    const record =
      this.#recordFromPersistence(
        persisted,
        candidate,
      );

    this.#cacheWrite(
      record,
    );

    this.statistics
      .commits +=
      1;

    const result =
      this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.COMMITTED,

          decision:
            IDEMPOTENCY_DECISIONS.CONTINUE,

          committed:
            true,

          replay:
            false,

          resourceId:
            record.resourceId,

          response:
            record.response,

          record:
            this.#publicRecord(
              record,
            ),
        },
      );

    await this.#audit(
      result,
      ACTIONS.COMMIT,
    );

    await this.#emit(
      result,
      'AIRTEL_COLLECTION_IDEMPOTENCY_COMMITTED',
    );

    this.#metric(
      'increment',
      'titech_airtel_collection_idempotency_committed_total',
    );

    return result;
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
    const identity =
      this.#normalizeInput(
        input,
      );

    this.#requireAtomic(
      [
        'releaseIfOwner',
        'release',
        'rollback',
        'unlock',
        'atomicRelease',
      ],

      identity.tenantId,
      identity.correlationId,
      identity.operationId,
    );

    const existing =
      await this.get(
        {
          ...identity,

          includeExpired:
            true,
        },
      );

    if (!existing) {
      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.RELEASED,

          decision:
            IDEMPOTENCY_DECISIONS.STOP,

          released:
            false,

          notFound:
            true,
        },
      );
    }

    if (
      existing.fingerprint !==
      identity.fingerprint
    ) {
      this.statistics
        .conflicts +=
        1;

      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.CONFLICT,

          decision:
            IDEMPOTENCY_DECISIONS.CONFLICT,

          conflict:
            true,

          existing:
            this.#publicRecord(
              existing,
            ),
        },
      );
    }

    if (
      existing.state ===
      IDEMPOTENCY_STATES.COMMITTED
    ) {
      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.COMMITTED,

          decision:
            IDEMPOTENCY_DECISIONS.STOP,

          released:
            false,

          committed:
            true,

          existing:
            this.#publicRecord(
              existing,
            ),
        },
      );
    }

    if (
      identity.token &&
      existing.reservationToken &&
      identity.token !==
        existing.reservationToken
    ) {
      throw new AirtelCollectionIdempotencyError(
        'Reservation owner mismatch.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_RESERVATION_OWNER_CONFLICT',

          statusCode:
            409,

          retryable:
            true,

          tenantId:
            identity.tenantId,

          correlationId:
            identity.correlationId,

          operationId:
            identity.operationId,
        },
      );
    }

    const candidate = {
      ...existing,

      state:
        IDEMPOTENCY_STATES.RELEASED,

      leaseExpiresAt:
        null,

      releasedAt:
        identity.at,

      updatedAt:
        identity.at,

      stateVersion:
        Number(
          existing.stateVersion ||
            0,
        ) +
        1,

      releaseReason:
        bounded(
          input.reason,
          300,
        ),
    };

    try {
      if (
        this.repository
      ) {
        const call =
          await this.#repositoryCall(
            [
              'releaseIfOwner',
              'release',
              'rollback',
              'unlock',
              'atomicRelease',
            ],

            candidate,
          );

        if (
          !call.called &&
          !this.config
            .allowInMemoryStore
        ) {
          throw new Error(
            'Atomic release contract unavailable.',
          );
        }

        if (
          call.called &&
          call.value
        ) {
          Object.assign(
            candidate,
            call.value.record ||
              call.value,
          );
        }
      }
    } catch (error) {
      this.statistics
        .failed +=
        1;

      throw new AirtelCollectionIdempotencyError(
        'Idempotency release failed.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_RELEASE_FAILED',

          statusCode:
            503,

          retryable:
            true,

          tenantId:
            identity.tenantId,

          correlationId:
            identity.correlationId,

          operationId:
            identity.operationId,

          cause:
            error,
        },
      );
    }

    this.#cacheWrite(
      candidate,
    );

    this.statistics
      .releases +=
      1;

    const result =
      this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.RELEASED,

          decision:
            IDEMPOTENCY_DECISIONS.STOP,

          released:
            true,

          record:
            this.#publicRecord(
              candidate,
            ),
        },
      );

    await this.#audit(
      result,
      ACTIONS.RELEASE,
    );

    await this.#emit(
      result,
      'AIRTEL_COLLECTION_IDEMPOTENCY_RELEASED',
    );

    return result;
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

  async reclaim(
    input = {},
  ) {
    const identity =
      this.#normalizeInput(
        input,
      );

    this.#requireAtomic(
      [
        'reclaimExpired',
        'reclaimIfExpired',
        'reclaim',
        'atomicReclaim',
      ],

      identity.tenantId,
      identity.correlationId,
      identity.operationId,
    );

    const existing =
      await this.get(
        {
          ...identity,

          includeExpired:
            true,
        },
      );

    if (!existing) {
      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.EXPIRED,

          decision:
            IDEMPOTENCY_DECISIONS.STOP,

          expired:
            false,

          notFound:
            true,
        },
      );
    }

    if (
      existing.fingerprint !==
      identity.fingerprint
    ) {
      this.statistics
        .conflicts +=
        1;

      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.CONFLICT,

          decision:
            IDEMPOTENCY_DECISIONS.CONFLICT,

          conflict:
            true,

          existing:
            this.#publicRecord(
              existing,
            ),
        },
      );
    }

    if (
      existing.state ===
      IDEMPOTENCY_STATES.COMMITTED
    ) {
      this.statistics
        .replays +=
        1;

      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.REPLAY,

          decision:
            IDEMPOTENCY_DECISIONS.REPLAY,

          committed:
            true,

          replay:
            true,

          existing:
            this.#publicRecord(
              existing,
            ),
        },
      );
    }

    if (
      !isLeaseExpired(
        existing,
        identity.at.getTime(),
      )
    ) {
      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.ALREADY_RESERVED,

          decision:
            IDEMPOTENCY_DECISIONS.IN_FLIGHT,

          inFlight:
            true,

          alreadyReserved:
            true,

          existing:
            this.#publicRecord(
              existing,
            ),
        },
      );
    }

    const candidate = {
      ...existing,

      state:
        IDEMPOTENCY_STATES.RESERVED,

      reservationId:
        identity.reservationId ||
        this.idFactory(),

      reservationToken:
        identity.token ||
        this.idFactory(),

      leaseExpiresAt:
        new Date(
          identity.at.getTime() +
            identity.leaseSeconds *
              1000,
        ),

      expiresAt:
        new Date(
          identity.at.getTime() +
            identity.ttlSeconds *
              1000,
        ),

      updatedAt:
        identity.at,

      stateVersion:
        Number(
          existing.stateVersion ||
            0,
        ) +
        1,

      reclaimCount:
        Number(
          existing.reclaimCount ||
            0,
        ) +
        1,

      reclaimedAt:
        identity.at,
    };

    try {
      if (
        this.repository
      ) {
        const call =
          await this.#repositoryCall(
            [
              'reclaimExpired',
              'reclaimIfExpired',
              'reclaim',
              'atomicReclaim',
            ],

            candidate,
          );

        if (
          !call.called &&
          !this.config
            .allowInMemoryStore
        ) {
          throw new Error(
            'Atomic reclaim contract unavailable.',
          );
        }

        if (
          call.called &&
          call.value
        ) {
          Object.assign(
            candidate,
            call.value.record ||
              call.value,
          );
        }
      }
    } catch (error) {
      this.statistics
        .failed +=
        1;

      throw new AirtelCollectionIdempotencyError(
        'Idempotency reclaim failed.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_RECLAIM_FAILED',

          statusCode:
            503,

          retryable:
            true,

          tenantId:
            identity.tenantId,

          correlationId:
            identity.correlationId,

          operationId:
            identity.operationId,

          cause:
            error,
        },
      );
    }

    this.#cacheWrite(
      candidate,
    );

    this.statistics
      .reclaims +=
      1;

    const result =
      this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.RECLAIMED,

          decision:
            IDEMPOTENCY_DECISIONS.CONTINUE,

          reclaimed:
            true,

          reserved:
            true,

          reservationId:
            candidate.reservationId,

          reservationToken:
            candidate.reservationToken,

          leaseExpiresAt:
            candidate.leaseExpiresAt,

          record:
            this.#publicRecord(
              candidate,
            ),
        },
      );

    await this.#audit(
      result,
      ACTIONS.RECLAIM,
    );

    await this.#emit(
      result,
      'AIRTEL_COLLECTION_IDEMPOTENCY_RECLAIMED',
    );

    return result;
  }

  async expire(
    input = {},
  ) {
    const identity =
      this.#normalizeInput(
        input,
      );

    this.#requireAtomic(
      [
        'expireIfOwned',
        'expire',
        'markExpired',
        'atomicExpire',
      ],

      identity.tenantId,
      identity.correlationId,
      identity.operationId,
    );

    const existing =
      await this.get(
        {
          ...identity,

          includeExpired:
            true,
        },
      );

    if (!existing) {
      return this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.EXPIRED,

          decision:
            IDEMPOTENCY_DECISIONS.STOP,

          expired:
            false,

          notFound:
            true,
        },
      );
    }

    if (
      existing.state ===
        IDEMPOTENCY_STATES.COMMITTED ||
      !isLeaseExpired(
        existing,
        identity.at.getTime(),
      )
    ) {
      return this.#result(
        identity,
        {
          outcome:
            existing.state ===
            IDEMPOTENCY_STATES.COMMITTED
              ? IDEMPOTENCY_OUTCOMES.COMMITTED
              : IDEMPOTENCY_OUTCOMES.ALREADY_RESERVED,

          decision:
            existing.state ===
            IDEMPOTENCY_STATES.COMMITTED
              ? IDEMPOTENCY_DECISIONS.STOP
              : IDEMPOTENCY_DECISIONS.IN_FLIGHT,

          existing:
            this.#publicRecord(
              existing,
            ),
        },
      );
    }

    const candidate = {
      ...existing,

      state:
        IDEMPOTENCY_STATES.EXPIRED,

      leaseExpiresAt:
        null,

      expiredAt:
        identity.at,

      updatedAt:
        identity.at,

      stateVersion:
        Number(
          existing.stateVersion ||
            0,
        ) +
        1,
    };

    try {
      if (
        this.repository
      ) {
        const call =
          await this.#repositoryCall(
            [
              'expireIfOwned',
              'expire',
              'markExpired',
              'atomicExpire',
            ],

            candidate,
          );

        if (
          !call.called &&
          !this.config
            .allowInMemoryStore
        ) {
          throw new Error(
            'Atomic expire contract unavailable.',
          );
        }

        if (
          call.called &&
          call.value
        ) {
          Object.assign(
            candidate,
            call.value.record ||
              call.value,
          );
        }
      }
    } catch (error) {
      this.statistics
        .failed +=
        1;

      throw new AirtelCollectionIdempotencyError(
        'Idempotency expiry failed.',
        {
          code:
            'AIRTEL_COLLECTION_IDEMPOTENCY_EXPIRE_FAILED',

          statusCode:
            503,

          retryable:
            true,

          tenantId:
            identity.tenantId,

          correlationId:
            identity.correlationId,

          operationId:
            identity.operationId,

          cause:
            error,
        },
      );
    }

    this.#cacheWrite(
      candidate,
    );

    this.statistics
      .expirations +=
      1;

    const result =
      this.#result(
        identity,
        {
          outcome:
            IDEMPOTENCY_OUTCOMES.EXPIRED,

          decision:
            IDEMPOTENCY_DECISIONS.STOP,

          expired:
            true,

          record:
            this.#publicRecord(
              candidate,
            ),
        },
      );

    await this.#audit(
      result,
      ACTIONS.EXPIRE,
    );

    await this.#emit(
      result,
      'AIRTEL_COLLECTION_IDEMPOTENCY_EXPIRED',
    );

    return result;
  }

  async get(
    input = {},
  ) {
    const identity =
      this.#normalizeInput(
        input,
        {
          requireResourceId:
            false,
        },
      );

    const cached =
      this.#cacheRead(
        identity,
      );

    if (cached) {
      return cached;
    }

    if (
      this.repository
    ) {
      const call =
        await this.#repositoryCall(
          [
            'findByScopedKey',
            'findByKey',
            'findOne',
            'get',
            'getByKey',
            'findByIdempotencyKey',
          ],

          identity,
        );

      if (
        call.called
      ) {
        const value =
          call.value?.record ||
          call.value?.idempotency ||
          call.value;

        if (!value) {
          return null;
        }

        const record =
          this.#recordFromPersistence(
            value,
            {
              ...identity,

              provider:
                PROVIDER,

              operation:
                OPERATION,

              state:
                value.state ||
                IDEMPOTENCY_STATES.RESERVED,
            },
          );

        this.#cacheWrite(
          record,
        );

        return record;
      }

      if (
        this.config
          .requireAtomicRepository &&
        !this.config
          .allowInMemoryStore
      ) {
        throw new AirtelCollectionIdempotencyError(
          'Idempotency repository lookup contract is unavailable.',
          {
            code:
              'AIRTEL_COLLECTION_IDEMPOTENCY_LOOKUP_UNAVAILABLE',

            statusCode:
              503,

            retryable:
              true,

            tenantId:
              identity.tenantId,

            correlationId:
              identity.correlationId,

            operationId:
              identity.operationId,
          },
        );
      }
    }

    return this.#cacheRead(
      identity,
    );
  }

  async status(
    input = {},
  ) {
    const record =
      await this.get(
        input,
      );

    if (!record) {
      return null;
    }

    return this.#publicRecord(
      record,
    );
  }

  async check(
    input = {},
  ) {
    return this.reserve(
      input,
    );
  }

  async inspect(
    input = {},
  ) {
    const record =
      await this.get(
        input,
      );

    return record
      ? this.#publicRecord(
          record,
        )
      : null;
  }

  async reclaimExpired(
    input = {},
  ) {
    return this.reclaim(
      input,
    );
  }

  #recordFromPersistence(
    value,
    fallback,
  ) {
    const record = {
      ...fallback,
      ...(value || {}),
    };

    return {
      ...record,

      tenantId:
        bounded(
          record.tenantId ??
            fallback.tenantId,

          this.config
            .maxTenantIdLength,
        ),

      provider:
        upper(
          record.provider ??
            PROVIDER,
        ),

      operation:
        upper(
          record.operation ??
            OPERATION,
        ),

      key:
        normalizeKey(
          record.key ??
            fallback.key,

          this.config
            .maxKeyLength,
        ),

      fingerprint:
        normalizeFingerprint(
          record.fingerprint ??
            fallback.fingerprint,

          this.config
            .maxFingerprintLength,
        ),

      resourceId:
        bounded(
          record.resourceId ??
            fallback.resourceId,

          this.config
            .maxResourceIdLength,
        ),

      state:
        upper(
          record.state ??
            fallback.state,
        ) ||
        IDEMPOTENCY_STATES.RESERVED,

      reservationId:
        bounded(
          record.reservationId ??
            fallback.reservationId,
          160,
        ),

      reservationToken:
        bounded(
          record.reservationToken ??
            fallback.reservationToken,
          160,
        ),

      leaseExpiresAt:
        safeDate(
          record.leaseExpiresAt,
        ),

      expiresAt:
        safeDate(
          record.expiresAt,
        ),

      createdAt:
        safeDate(
          record.createdAt,
        ) ||
        fallback.at ||
        new Date(
          this.#now(),
        ),

      updatedAt:
        safeDate(
          record.updatedAt,
        ) ||
        fallback.at ||
        new Date(
          this.#now(),
        ),

      committedAt:
        safeDate(
          record.committedAt,
        ),

      releasedAt:
        safeDate(
          record.releasedAt,
        ),

      expiredAt:
        safeDate(
          record.expiredAt,
        ),

      response:
        this.#boundedResponse(
          record.response,
        ),

      stateVersion:
        Number.isInteger(
          Number(
            record.stateVersion,
          ),
        )
          ? Number(
              record.stateVersion,
            )
          : 0,

      attempts:
        Number.isInteger(
          Number(
            record.attempts,
          ),
        )
          ? Number(
              record.attempts,
            )
          : 0,

      metadata:
        sanitize(
          record.metadata ||
            {},
          this.config,
        ),
    };
  }

  #publicRecord(
    record,
  ) {
    if (!record) {
      return null;
    }

    return {
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        record.tenantId,

      keyFingerprint:
        sha256(
          record.key ||
            '',
        ),

      fingerprint:
        record.fingerprint,

      resourceId:
        record.resourceId ??
        null,

      resourceType:
        record.resourceType ??
        null,

      state:
        record.state,

      reservationId:
        record.reservationId ??
        null,

      leaseExpiresAt:
        record.leaseExpiresAt ??
        null,

      expiresAt:
        record.expiresAt ??
        null,

      committedAt:
        record.committedAt ??
        null,

      releasedAt:
        record.releasedAt ??
        null,

      expiredAt:
        record.expiredAt ??
        null,

      response:
        record.response,

      stateVersion:
        record.stateVersion ??
        0,

      attempts:
        record.attempts ??
        0,

      createdAt:
        record.createdAt,

      updatedAt:
        record.updatedAt,

      metadata:
        sanitize(
          record.metadata ||
            {},
          this.config,
        ),
    };
  }

  #result(
    identity,
    fields = {},
  ) {
    return Object.freeze({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        identity.tenantId,

      correlationId:
        identity.correlationId ??
        null,

      operationId:
        identity.operationId ??
        null,

      outcome:
        fields.outcome,

      decision:
        fields.decision,

      reserved:
        Boolean(
          fields.reserved,
        ),

      alreadyReserved:
        Boolean(
          fields.alreadyReserved,
        ),

      inFlight:
        Boolean(
          fields.inFlight,
        ),

      committed:
        Boolean(
          fields.committed,
        ),

      replay:
        Boolean(
          fields.replay,
        ),

      conflict:
        Boolean(
          fields.conflict,
        ),

      released:
        Boolean(
          fields.released,
        ),

      reclaimed:
        Boolean(
          fields.reclaimed,
        ),

      expired:
        Boolean(
          fields.expired,
        ),

      reservationId:
        fields.reservationId ??
        null,

      reservationToken:
        fields.reservationToken ??
        null,

      leaseExpiresAt:
        fields.leaseExpiresAt ??
        null,

      expiresAt:
        fields.expiresAt ??
        null,

      resourceId:
        fields.resourceId ??
        null,

      response:
        fields.response,

      state:
        fields.state ??
        fields.record?.state ??
        fields.existing?.state ??
        null,

      reason:
        bounded(
          fields.reason,
          500,
        ),

      existing:
        fields.existing,

      record:
        fields.record,

      timestamp:
        new Date(
          this.#now(),
        ),
    });
  }

  async #audit(
    result,
    action,
  ) {
    const fn =
      this.auditService?.record ||
      this.auditService?.append ||
      this.auditService?.write ||
      this.auditService?.log;

    if (
      !isFunction(fn)
    ) {
      return null;
    }

    const payload = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      action,

      tenantId:
        result.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      keyFingerprint:
        result.existing
          ?.keyFingerprint ||
        result.record
          ?.keyFingerprint ||
        null,

      semanticFingerprint:
        result.record
          ?.fingerprint ||
        result.existing
          ?.fingerprint ||
        null,

      outcome:
        result.outcome,

      decision:
        result.decision,

      state:
        result.state,

      resourceId:
        result.resourceId,

      reservationId:
        result.reservationId,

      correlationId:
        result.correlationId,

      operationId:
        result.operationId,

      occurredAt:
        nowIso(
          this.clock,
        ),

      auditFingerprint:
        null,
    };

    payload.auditFingerprint =
      sha256(
        payload,
      );

    try {
      return await fn.call(
        this.auditService,
        payload,
      );
    } catch (error) {
      this.statistics
        .auditFailures +=
        1;

      this.#log(
        'warn',
        'Collection idempotency audit write failed.',
        {
          error:
            safeError(
              error,
            ),
        },
      );

      if (
        this.config
          .failClosedOnAuditError
      ) {
        throw new AirtelCollectionIdempotencyError(
          'Idempotency audit boundary is unavailable.',
          {
            code:
              'AIRTEL_COLLECTION_IDEMPOTENCY_AUDIT_UNAVAILABLE',

            statusCode:
              503,

            retryable:
              true,

            tenantId:
              result.tenantId,

            correlationId:
              result.correlationId,

            operationId:
              result.operationId,
          },
        );
      }

      return null;
    }
  }

  async #emit(
    result,
    type,
  ) {
    const fn =
      this.eventBus?.publish ||
      this.eventBus?.enqueue ||
      this.eventBus?.emit;

    if (
      !isFunction(fn)
    ) {
      return null;
    }

    const event = {
      eventId:
        this.idFactory(),

      schemaVersion:
        SCHEMA_VERSION,

      type,

      tenantId:
        result.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      correlationId:
        result.correlationId,

      operationId:
        result.operationId,

      outcome:
        result.outcome,

      decision:
        result.decision,

      state:
        result.state,

      keyFingerprint:
        result.existing
          ?.keyFingerprint ||
        result.record
          ?.keyFingerprint ||
        null,

      semanticFingerprint:
        result.record
          ?.fingerprint ||
        result.existing
          ?.fingerprint ||
        null,

      resourceId:
        result.resourceId,

      reservationId:
        result.reservationId,

      occurredAt:
        nowIso(
          this.clock,
        ),
    };

    try {
      return await fn.call(
        this.eventBus,
        event,
      );
    } catch (error) {
      this.statistics
        .eventFailures +=
        1;

      this.#log(
        'warn',
        'Collection idempotency event publication failed.',
        {
          error:
            safeError(
              error,
            ),
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        throw new AirtelCollectionIdempotencyError(
          'Idempotency event boundary is unavailable.',
          {
            code:
              'AIRTEL_COLLECTION_IDEMPOTENCY_EVENT_UNAVAILABLE',

            statusCode:
              503,

            retryable:
              true,

            tenantId:
              result.tenantId,

            correlationId:
              result.correlationId,

            operationId:
              result.operationId,
          },
        );
      }

      return null;
    }
  }

  #metric(
    method,
    name,
    value = 1,
  ) {
    try {
      const fn =
        this.metrics?.[
          method
        ];

      if (
        !isFunction(fn)
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

  #log(
    level,
    message,
    context = {},
  ) {
    try {
      const fn =
        this.logger?.[
          level
        ] ||
        this.logger?.log ||
        this.logger?.info;

      if (
        !isFunction(fn)
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
      // Logging is non-authoritative.
    }
  }

  statisticsSnapshot() {
    return Object.freeze({
      ...this.statistics,
    });
  }

  resetStatistics() {
    for (
      const key of Object.keys(
        this.statistics,
      )
    ) {
      this.statistics[key] =
        0;
    }

    return this.statisticsSnapshot();
  }

  health() {
    const repositoryAtomic =
      this.#repositoryHasAtomic(
        [
          'reserveIfAbsent',
          'reserve',
          'createIfAbsent',
          'claimIfAbsent',
          'atomicReserve',

          'commitIfOwner',
          'commit',
          'finalize',
          'complete',
          'markCommitted',
          'atomicCommit',

          'releaseIfOwner',
          'release',
          'rollback',
          'unlock',
          'atomicRelease',
        ],
      );

    const lookup =
      this.#repositoryHasAtomic(
        [
          'findByScopedKey',
          'findByKey',
          'findOne',
          'get',
          'getByKey',
          'findByIdempotencyKey',
        ],
      );

    const ready =
      Boolean(
        this.repository,
      ) &&
      repositoryAtomic &&
      lookup;

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      status:
        ready ||
        this.config
          .allowInMemoryStore
          ? 'UP'
          : 'DEGRADED',

      ready:
        ready ||
        this.config
          .allowInMemoryStore,

      authoritativeRepository:
        Boolean(
          this.repository,
        ),

      repositoryAtomic:
        repositoryAtomic,

      repositoryLookup:
        lookup,

      inMemoryAllowed:
        this.config
          .allowInMemoryStore,

      statistics:
        this.statisticsSnapshot(),

      capabilities:
        CAPABILITIES,

      financialBoundary:
        FINANCIAL_BOUNDARY,

      timestamp:
        nowIso(
          this.clock,
        ),
    };
  }

  readiness() {
    const health =
      this.health();

    return {
      ready:
        health.ready,

      status:
        health.status,

      missing:
        health.ready
          ? []
          : [
              ...(
                this.repository
                  ? []
                  : [
                      'repository',
                    ]
              ),

              ...(
                this.#repositoryHasAtomic(
                  [
                    'findByScopedKey',
                    'findByKey',
                    'findOne',
                    'get',
                    'getByKey',
                    'findByIdempotencyKey',
                  ],
                )
                  ? []
                  : [
                      'lookup',
                    ]
              ),

              ...(
                this.#repositoryHasAtomic(
                  [
                    'reserveIfAbsent',
                    'reserve',
                    'createIfAbsent',
                    'claimIfAbsent',
                    'atomicReserve',
                  ],
                )
                  ? []
                  : [
                      'atomicReserve',
                    ]
              ),
            ],

      timestamp:
        nowIso(
          this.clock,
        ),
    };
  }

  capabilities() {
    return Object.freeze({
      ...CAPABILITIES,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,
    });
  }

  diagnostics() {
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
        this.health(),

      readiness:
        this.readiness(),

      statistics:
        this.statisticsSnapshot(),

      configuration:
        sanitize(
          this.config,
          this.config,
        ),

      boundaries: {
        providerHttp:
          false,

        ledgerWrites:
          false,

        balanceMutation:
          false,

        walletMutation:
          false,

        settlementFinality:
          false,
      },

      security: {
        rawIdempotencyKeyAudit:
          false,

        rawIdempotencyKeyEvent:
          false,

        rawIdempotencyKeyLogs:
          false,

        tenantIsolation:
          true,

        fingerprintConflictProtection:
          true,

        concurrentDuplicateProtection:
          true,

        leaseProtection:
          true,
      },
    };
  }

  snapshot() {
    return this.diagnostics();
  }
}

function safeError(
  error,
) {
  return {
    name:
      bounded(
        error?.name,
        120,
      ),

    code:
      bounded(
        error?.code,
        160,
      ),

    message:
      bounded(
        error?.message,
        500,
      ),

    retryable:
      Boolean(
        error?.retryable,
      ),
  };
}

function nowIso(
  clock,
) {
  try {
    const value =
      typeof clock ===
      'function'
        ? clock()
        : clock.now();

    const date =
      value instanceof Date
        ? value
        : new Date(value);

    return Number.isNaN(
      date.getTime(),
    )
      ? new Date()
          .toISOString()
      : date.toISOString();
  } catch {
    return new Date()
      .toISOString();
  }
}

export function createCollectionIdempotencyManager(
  options = {},
) {
  return new AirtelCollectionIdempotencyManager(
    options,
  );
}

export function createCollectionIdempotencyFingerprint(
  input = {},
) {
  return sha256({
    tenantId:
      input.tenantId ??
      null,

    provider:
      PROVIDER,

    operation:
      OPERATION,

    collectionId:
      input.collectionId ??
      input.resourceId ??
      null,

    amountMinor:
      input.amountMinor ??
      null,

    currency:
      input.currency ??
      null,

    phoneNumber:
      input.phoneNumber ??
      input.msisdn ??
      null,

    externalReference:
      input.externalReference ??
      input.reference ??
      null,

    payer:
      sanitize(
        input.payer ??
          {},
        DEFAULT_CONFIGURATION,
      ),
  });
}

export function hashCollectionIdempotencyKey(
  key,
) {
  return sha256(
    String(
      key ?? '',
    ),
  );
}

export function normalizeCollectionIdempotencyKey(
  key,
) {
  return normalizeKey(
    key,
    DEFAULT_CONFIGURATION
      .maxKeyLength,
  );
}

export function normalizeCollectionFingerprint(
  fingerprint,
) {
  return normalizeFingerprint(
    fingerprint,
    DEFAULT_CONFIGURATION
      .maxFingerprintLength,
  );
}

export function isCollectionIdempotencyTerminal(
  state,
) {
  return [
    IDEMPOTENCY_STATES.COMMITTED,
    IDEMPOTENCY_STATES.RELEASED,
    IDEMPOTENCY_STATES.EXPIRED,
    IDEMPOTENCY_STATES.FAILED,
  ].includes(
    upper(state),
  );
}

export function isCollectionIdempotencyReplayable(
  state,
) {
  return (
    upper(state) ===
    IDEMPOTENCY_STATES.COMMITTED
  );
}

export function getDefaultConfiguration() {
  return clone(
    DEFAULT_CONFIGURATION,
  );
}

export default AirtelCollectionIdempotencyManager;