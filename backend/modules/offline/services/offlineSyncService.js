'use strict';

/**
 * =============================================================================
 * TITech Capital LTD — TITech Community Capital
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/services/offlineSyncService.js
 *
 * Purpose:
 *   Enterprise-grade offline synchronization orchestration service.
 *
 * Responsibilities:
 *
 *   - Validate offline sync requests
 *   - Authenticate / authorize offline devices
 *   - Enforce tenant isolation
 *   - Validate event identity
 *   - Validate event ordering
 *   - Enforce idempotency
 *   - Process offline events transactionally
 *   - Generate immutable receipts
 *   - Maintain synchronization cursors
 *   - Detect conflicts
 *   - Support partial batch processing
 *   - Support retry-safe synchronization
 *   - Protect financial operations
 *   - Preserve auditability
 *   - Support reconciliation workflows
 *   - Produce deterministic sync responses
 *
 * IMPORTANT:
 *
 *   This service orchestrates synchronization.
 *
 *   It does NOT replace:
 *
 *     - TITech financial transaction boundary
 *     - TITech ledger service
 *     - TITech wallet service
 *     - TITech loan service
 *     - TITech savings service
 *     - Mobile-money integration services
 *     - KYC / AML services
 *
 * Financial operations MUST enter the authoritative transaction boundary
 * before becoming financially final.
 *
 * =============================================================================
 *
 * Synchronization architecture:
 *
 *   Offline Device
 *        |
 *        v
 *   Sync API
 *        |
 *        v
 *   offlineSyncService
 *        |
 *        +------------------------------+
 *        |                              |
 *        v                              v
 *   Device Validation              Batch Validation
 *        |                              |
 *        +---------------+--------------+
 *                        |
 *                        v
 *                  Idempotency
 *                        |
 *                        v
 *               MongoDB Transaction
 *                        |
 *              +---------+---------+
 *              |                   |
 *              v                   v
 *        Event Persistence      Domain Operation
 *              |                   |
 *              +---------+---------+
 *                        |
 *                        v
 *                 Receipt Service
 *                        |
 *                        v
 *                  Sync Cursor
 *                        |
 *                        v
 *                Reconciliation
 *
 * =============================================================================
 */

import crypto from 'node:crypto';

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME =
  'TITech.offlineSyncService';

const SYNC_VERSION =
  '1.0';

const DEFAULT_BATCH_SIZE =
  100;

const MAX_BATCH_SIZE =
  500;

const DEFAULT_MAX_RETRIES =
  5;

const DEFAULT_RETRY_DELAY_MS =
  500;

const MAX_RETRY_DELAY_MS =
  30_000;

const MAX_EVENT_ID_LENGTH =
  256;

const MAX_IDEMPOTENCY_KEY_LENGTH =
  256;

const MAX_DEVICE_ID_LENGTH =
  256;

const MAX_TENANT_ID_LENGTH =
  256;

const MAX_CURSOR_LENGTH =
  256;

const FINANCIAL_OPERATION_TYPES =
  new Set([
    'CONTRIBUTION',
    'DEPOSIT',
    'WITHDRAWAL',
    'TRANSFER',
    'PAYMENT',
    'LOAN_DISBURSEMENT',
    'LOAN_REPAYMENT',
    'SAVINGS_DEPOSIT',
    'SAVINGS_WITHDRAWAL',
    'WALLET_CREDIT',
    'WALLET_DEBIT',
    'MOMO_COLLECTION',
    'MOMO_PAYOUT',
    'LEDGER_ENTRY',
  ]);

const NON_RETRYABLE_CODES =
  new Set([
    'OFFLINE_SYNC_INVALID_REQUEST',
    'OFFLINE_SYNC_TENANT_MISMATCH',
    'OFFLINE_SYNC_DEVICE_INVALID',
    'OFFLINE_SYNC_DEVICE_REVOKED',
    'OFFLINE_SYNC_EVENT_INVALID',
    'OFFLINE_SYNC_EVENT_DUPLICATE',
    'OFFLINE_SYNC_IDEMPOTENCY_CONFLICT',
    'OFFLINE_SYNC_EVENT_CONFLICT',
    'OFFLINE_SYNC_SEQUENCE_CONFLICT',
    'OFFLINE_SYNC_CURSOR_INVALID',
    'OFFLINE_SYNC_SIGNATURE_INVALID',
    'OFFLINE_SYNC_FINANCIAL_AUTHORIZATION_REQUIRED',
  ]);

// =============================================================================
// Error Factory
// =============================================================================

function createServiceError(
  message,
  code,
  statusCode = 400,
  details = null,
) {
  const error =
    new Error(message);

  error.name =
    'OfflineSyncServiceError';

  error.code =
    code;

  error.statusCode =
    statusCode;

  if (details !== null) {
    error.details =
      details;
  }

  return error;
}

// =============================================================================
// Generic Helpers
// =============================================================================

function requireString(
  value,
  fieldName,
  maxLength = null,
) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw createServiceError(
      `${fieldName} is required.`,
      'OFFLINE_SYNC_INVALID_REQUEST',
      400,
      {
        field:
          fieldName,
      },
    );
  }

  const normalized =
    value.trim();

  if (
    maxLength &&
    normalized.length >
      maxLength
  ) {
    throw createServiceError(
      `${fieldName} exceeds the maximum permitted length.`,
      'OFFLINE_SYNC_INVALID_REQUEST',
      400,
      {
        field:
          fieldName,

        maxLength,
      },
    );
  }

  return normalized;
}

function optionalString(
  value,
  fieldName,
  maxLength = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return requireString(
    value,
    fieldName,
    maxLength,
  );
}

function normalizeBatch(
  events,
  maxBatchSize =
    MAX_BATCH_SIZE,
) {
  if (
    !Array.isArray(events)
  ) {
    throw createServiceError(
      'Offline sync events must be an array.',
      'OFFLINE_SYNC_INVALID_REQUEST',
      400,
    );
  }

  if (
    events.length === 0
  ) {
    return [];
  }

  if (
    events.length >
    maxBatchSize
  ) {
    throw createServiceError(
      `Offline sync batch exceeds the maximum batch size of ${maxBatchSize}.`,
      'OFFLINE_SYNC_BATCH_TOO_LARGE',
      413,
      {
        received:
          events.length,

        maximum:
          maxBatchSize,
      },
    );
  }

  return events;
}

function normalizeNumber(
  value,
  fieldName,
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    throw createServiceError(
      `${fieldName} must be a valid number.`,
      'OFFLINE_SYNC_INVALID_REQUEST',
      400,
      {
        field:
          fieldName,
      },
    );
  }

  return number;
}

function normalizeSequence(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const sequence =
    normalizeNumber(
      value,
      'sequenceNumber',
    );

  if (
    !Number.isSafeInteger(
      sequence,
    ) ||
    sequence < 0
  ) {
    throw createServiceError(
      'sequenceNumber must be a non-negative safe integer.',
      'OFFLINE_SYNC_EVENT_INVALID',
      400,
    );
  }

  return sequence;
}

function generateOperationId() {
  return `SYNC_${Date.now()}_${crypto
    .randomBytes(12)
    .toString('hex')}`;
}

function calculateBackoff(
  attempt,
  baseDelay =
    DEFAULT_RETRY_DELAY_MS,
  maxDelay =
    MAX_RETRY_DELAY_MS,
) {
  const exponential =
    Math.min(
      maxDelay,
      baseDelay *
        Math.pow(
          2,
          Math.max(
            attempt - 1,
            0,
          ),
        ),
    );

  const jitter =
    Math.floor(
      Math.random() *
        Math.max(
          exponential * 0.25,
          1,
        ),
    );

  return Math.min(
    maxDelay,
    exponential + jitter,
  );
}

function sleep(
  milliseconds,
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds,
      ),
  );
}

function stableSerialize(
  value,
) {
  if (
    Array.isArray(value)
  ) {
    return value.map(
      stableSerialize,
    );
  }

  if (
    value &&
    typeof value === 'object' &&
    !(
      value instanceof Date
    ) &&
    !Buffer.isBuffer(value)
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (
          result,
          key,
        ) => {
          result[key] =
            stableSerialize(
              value[key],
            );

          return result;
        },
        {},
      );
  }

  return value;
}

function canonicalize(
  value,
) {
  return JSON.stringify(
    stableSerialize(
      value,
    ),
  );
}

function hashEvent(
  event,
) {
  return crypto
    .createHash(
      'sha256',
    )
    .update(
      canonicalize(
        event,
      ),
      'utf8',
    )
    .digest(
      'hex',
    );
}

// These fields describe delivery state in the browser's IndexedDB outbox. They
// are intentionally outside the immutable event envelope hashed by the client.
// No arbitrary field is discarded: unknown additions remain in the envelope and
// consequently fail the hash comparison unless the client protocol is versioned.
const MUTABLE_OFFLINE_DELIVERY_FIELDS = Object.freeze([
  'status',
  'attempts',
  'createdAt',
  'updatedAt',
  'lastError',
]);

function canonicalClientEventEnvelope(event) {
  const envelope = { ...event };
  delete envelope.eventHash;
  for (const field of MUTABLE_OFFLINE_DELIVERY_FIELDS) {
    delete envelope[field];
  }
  return envelope;
}

function isFinancialEvent(
  event,
) {
  const type =
    String(
      event.eventType ||
        event.type ||
        event.operationType ||
        '',
    )
      .trim()
      .toUpperCase();

  return FINANCIAL_OPERATION_TYPES.has(
    type,
  );
}

function isRetryableError(
  error,
) {
  if (!error) {
    return false;
  }

  if (
    NON_RETRYABLE_CODES.has(
      error.code,
    )
  ) {
    return false;
  }

  if (
    error.retryable === false
  ) {
    return false;
  }

  if (
    Number(error.statusCode) >=
      400 &&
    Number(error.statusCode) <
      500
  ) {
    return false;
  }

  return true;
}

// =============================================================================
// Offline Sync Service
// =============================================================================

class OfflineSyncService {
  /**
   * @param {Object} options
   *
   * Dependencies are intentionally injected to keep the service testable and
   * prevent the offline module from becoming tightly coupled to infrastructure.
   */
  constructor({
    OfflineEvent = null,
    OfflineDevice = null,
    syncCursorModel = null,
    idempotencyStore = null,
    receiptService = null,
    offlineDeviceService = null,
    transactionBoundary = null,
    financialService = null,
    reconciliationService = null,
    conflictService = null,
    auditService = null,
    eventBus = null,
    logger = null,
    domainEventHandlers = {},
    config = {},
  } = {}) {
    this.OfflineEvent =
      OfflineEvent;

    this.OfflineDevice =
      OfflineDevice;

    this.SyncCursor =
      syncCursorModel;

    this.idempotencyStore =
      idempotencyStore;

    this.receiptService =
      receiptService;

    this.offlineDeviceService =
      offlineDeviceService;

    this.transactionBoundary =
      transactionBoundary;

    this.financialService =
      financialService;

    this.reconciliationService =
      reconciliationService;

    this.conflictService =
      conflictService;

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    // Domain handlers may be supplied by the canonical service container. The
    // meeting handler is loaded lazily only when an eligible event arrives, so
    // importing this orchestrator for non-meeting work does not eagerly load
    // meeting models or make the optional meeting domain a bootstrap side effect.
    this.domainEventHandlers = Object.freeze({
      ...domainEventHandlers,
    });

    this.logger =
      logger;

    this.config = {
      maxBatchSize:
        Math.min(
          Number(
            config.maxBatchSize ||
              MAX_BATCH_SIZE,
          ),
          MAX_BATCH_SIZE,
        ),

      defaultBatchSize:
        Number(
          config.defaultBatchSize ||
            DEFAULT_BATCH_SIZE,
        ),

      maxRetries:
        Number(
          config.maxRetries ||
            DEFAULT_MAX_RETRIES,
        ),

      retryDelayMs:
        Number(
          config.retryDelayMs ||
            DEFAULT_RETRY_DELAY_MS,
        ),

      maxRetryDelayMs:
        Number(
          config.maxRetryDelayMs ||
            MAX_RETRY_DELAY_MS,
        ),

      // Device registration is a mandatory security invariant. There is no
      // configuration switch that makes an unregistered device trustworthy.
      requireDeviceRegistration: true,

      requireEventHash:
        config.requireEventHash !==
        false,

      allowOutOfOrderEvents:
        config.allowOutOfOrderEvents ===
        true,

      financialOperationsRequireBoundary:
        config.financialOperationsRequireBoundary !==
        false,
    };
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  _log(
    level,
    message,
    context = {},
  ) {
    if (
      !this.logger ||
      typeof this.logger[level] !==
        'function'
    ) {
      return;
    }

    this.logger[level](
      `[${SERVICE_NAME}] ${message}`,
      context,
    );
  }

  // ===========================================================================
  // Audit
  // ===========================================================================

  async _audit(
    type,
    payload = {},
  ) {
    const auditPayload = {
      service:
        SERVICE_NAME,

      type,

      ...payload,

      occurredAt:
        new Date(),
    };

    try {
      if (
        this.auditService &&
        typeof this.auditService.record ===
          'function'
      ) {
        await this.auditService.record(
          auditPayload,
        );
      }

      if (
        this.eventBus &&
        typeof this.eventBus.publish ===
          'function'
      ) {
        await this.eventBus.publish(
          `offline.sync.${String(
            type,
          ).toLowerCase()}`,
          auditPayload,
        );
      }
    } catch (error) {
      this._log(
        'error',
        'Offline synchronization audit failed.',
        {
          type,
          error:
            error.message,
        },
      );

      throw createServiceError(
        'Offline synchronization audit failed.',
        'OFFLINE_SYNC_AUDIT_FAILURE',
        500,
      );
    }
  }

  // ===========================================================================
  // Request Validation
  // ===========================================================================

  validateSyncRequest(
    request,
  ) {
    if (
      !request ||
      typeof request !== 'object'
    ) {
      throw createServiceError(
        'Offline sync request is required.',
        'OFFLINE_SYNC_INVALID_REQUEST',
        400,
      );
    }

    const tenantId =
      requireString(
        request.tenantId,
        'tenantId',
        MAX_TENANT_ID_LENGTH,
      );

    const deviceId =
      requireString(
        request.deviceId,
        'deviceId',
        MAX_DEVICE_ID_LENGTH,
      );

    const events =
      normalizeBatch(
        request.events,
        this.config.maxBatchSize,
      );

    const syncRequestId =
      optionalString(
        request.syncRequestId,
        'syncRequestId',
        MAX_IDEMPOTENCY_KEY_LENGTH,
      ) ||
      generateOperationId();

    const cursor =
      optionalString(
        request.cursor,
        'cursor',
        MAX_CURSOR_LENGTH,
      );

    return {
      ...request,

      tenantId,

      deviceId,

      events,

      syncRequestId,

      cursor,

      protocolVersion:
        request.protocolVersion ||
        SYNC_VERSION,
    };
  }

  validateEvent(
    event,
    context,
  ) {
    if (
      !event ||
      typeof event !== 'object'
    ) {
      throw createServiceError(
        'Offline event must be an object.',
        'OFFLINE_SYNC_EVENT_INVALID',
        400,
      );
    }

    const eventId =
      requireString(
        event.eventId,
        'eventId',
        MAX_EVENT_ID_LENGTH,
      );

    const tenantId =
      requireString(
        event.tenantId,
        'event.tenantId',
        MAX_TENANT_ID_LENGTH,
      );

    const deviceId =
      requireString(
        event.deviceId,
        'event.deviceId',
        MAX_DEVICE_ID_LENGTH,
      );

    if (
      tenantId !==
      context.tenantId
    ) {
      throw createServiceError(
        'Offline event tenant does not match the synchronization tenant.',
        'OFFLINE_SYNC_TENANT_MISMATCH',
        403,
        {
          eventId,
        },
      );
    }

    if (
      deviceId !==
      context.deviceId
    ) {
      throw createServiceError(
        'Offline event device does not match the synchronization device.',
        'OFFLINE_SYNC_DEVICE_INVALID',
        403,
        {
          eventId,
        },
      );
    }

    const sequenceNumber =
      normalizeSequence(
        event.sequenceNumber,
      );

    const eventType =
      requireString(
        event.eventType ||
          event.type ||
          event.operationType,
        'eventType',
        128,
      );

    const idempotencyKey =
      optionalString(
        event.idempotencyKey,
        'idempotencyKey',
        MAX_IDEMPOTENCY_KEY_LENGTH,
      );

    const suppliedEventHash =
      optionalString(
        event.eventHash,
        'eventHash',
        512,
      );

    if (!Number.isInteger(event.eventVersion) || event.eventVersion !== 1) {
      throw createServiceError(
        'Unsupported offline event schema version.',
        'OFFLINE_SYNC_EVENT_INVALID',
        400,
        { eventId, supportedEventVersion: 1 },
      );
    }

    const calculatedEventHash = hashEvent(
      canonicalClientEventEnvelope(event),
    );

    if (
      this.config.requireEventHash &&
      !suppliedEventHash
    ) {
      throw createServiceError(
        'Offline event hash is required.',
        'OFFLINE_SYNC_EVENT_INVALID',
        400,
        {
          eventId,
        },
      );
    }

    if (
      suppliedEventHash &&
      suppliedEventHash !==
        calculatedEventHash
    ) {
      throw createServiceError(
        'Offline event hash validation failed.',
        'OFFLINE_SYNC_EVENT_CONFLICT',
        409,
        {
          eventId,

          expected:
            calculatedEventHash,

          received:
            suppliedEventHash,
        },
      );
    }

    return {
      ...event,

      eventId,

      tenantId,

      deviceId,

      eventType,

      sequenceNumber,

      idempotencyKey,

      eventHash:
        suppliedEventHash ||
        calculatedEventHash,

      receivedAt:
        new Date(),
    };
  }

  // ===========================================================================
  // Device Authorization
  // ===========================================================================

  async validateDevice(
    {
      tenantId,
      deviceId,
      deviceToken = null,
      deviceSignature = null,
      deviceFingerprint = null,
      deviceKeyId = null,
    },
  ) {
    if (
      !this.offlineDeviceService ||
      typeof this.offlineDeviceService.validateDevice !== 'function'
    ) {
      throw createServiceError(
        'Registered-device authorization is not configured.',
        'OFFLINE_SYNC_DEVICE_INVALID',
        503,
      );
    }

    const result = await this.offlineDeviceService.validateDevice({
      tenantId,
      deviceId,
      deviceToken,
      deviceSignature,
      deviceFingerprint,
      keyId: deviceKeyId,
      requireTrusted: true,
      requireActive: true,
    });

    if (result?.valid !== true || result?.authenticated !== true) {
      throw createServiceError(
        'Offline device authorization failed.',
        'OFFLINE_SYNC_DEVICE_INVALID',
        403,
      );
    }

    if (result.revoked === true) {
      throw createServiceError(
        'Offline device has been revoked.',
        'OFFLINE_SYNC_DEVICE_REVOKED',
        403,
      );
    }

    return result;
  }

  // ===========================================================================
  // Batch Ordering
  // ===========================================================================

  validateBatchOrdering(
    events,
  ) {
    if (
      this.config
        .allowOutOfOrderEvents
    ) {
      return true;
    }

    let previous =
      null;

    for (
      const event of events
    ) {
      if (
        event.sequenceNumber ===
        null
      ) {
        continue;
      }

      if (
        previous !== null &&
        event.sequenceNumber <=
          previous
      ) {
        throw createServiceError(
          'Offline events must be strictly ordered by sequenceNumber.',
          'OFFLINE_SYNC_SEQUENCE_CONFLICT',
          409,
          {
            previousSequence:
              previous,

            receivedSequence:
              event.sequenceNumber,
          },
        );
      }

      previous =
        event.sequenceNumber;
    }

    return true;
  }

  // ===========================================================================
  // Existing Event Lookup
  // ===========================================================================

  async findExistingEvent(
    event,
    {
      session = null,
    } = {},
  ) {
    if (
      !this.OfflineEvent
    ) {
      return null;
    }

    let query =
      this.OfflineEvent.findOne({
        tenantId:
          event.tenantId,

        eventId:
          event.eventId,
      });

    if (session) {
      query =
        query.session(
          session,
        );
    }

    return query
      .lean()
      .exec();
  }

  // ===========================================================================
  // Idempotency
  // ===========================================================================

  async getIdempotentResult(
    {
      tenantId,
      idempotencyKey,
    },
  ) {
    if (
      !this.idempotencyStore ||
      !idempotencyKey
    ) {
      return null;
    }

    if (
      typeof this.idempotencyStore.get !==
      'function'
    ) {
      return null;
    }

    return this.idempotencyStore.get({
      tenantId,

      idempotencyKey,
    });
  }

  async saveIdempotentResult(
    {
      tenantId,
      idempotencyKey,
      result,
      ttlSeconds = null,
    },
  ) {
    if (
      !this.idempotencyStore ||
      !idempotencyKey
    ) {
      return;
    }

    if (
      typeof this.idempotencyStore.set !==
      'function'
    ) {
      return;
    }

    await this.idempotencyStore.set(
      {
        tenantId,

        idempotencyKey,
      },

      result,

      ttlSeconds,
    );
  }

  // ===========================================================================
  // Conflict Detection
  // ===========================================================================

  async detectConflict(
    event,
    existingEvent,
  ) {
    if (
      !existingEvent
    ) {
      return {
        conflict: false,
      };
    }

    const incomingHash =
      event.eventHash;

    const existingHash =
      existingEvent.eventHash;

    if (
      incomingHash &&
      existingHash &&
      incomingHash ===
        existingHash
    ) {
      return {
        conflict: false,

        duplicate: true,
      };
    }

    if (
      this.conflictService &&
      typeof this.conflictService
        .detect ===
        'function'
    ) {
      const result =
        await this.conflictService.detect(
          {
            incoming:
              event,

            existing:
              existingEvent,
          },
        );

      return (
        result || {
          conflict: false,
        }
      );
    }

    return {
      conflict: true,

      duplicate: false,

      reason:
        'EVENT_ID_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT',
    };
  }

  // ===========================================================================
  // Financial Operation Boundary
  // ===========================================================================

  async processFinancialEvent(
    event,
    context,
  ) {
    if (!isFinancialEvent(event)) return null;

    const idempotency = this.idempotencyStore;
    const financial = this.financialService;
    const atomicFinancialProcessor =
      financial &&
      financial.supportsAtomicOfflineSync === true &&
      financial.persistsOfflineEventAtomically === true &&
      financial.persistsReceiptAtomically === true &&
      financial.usesDurableIdempotency === true &&
      typeof financial.processOfflineEventAtomically === 'function';
    const durableReservation =
      idempotency &&
      idempotency.isDurable === true &&
      idempotency.supportsAtomicFinancialReservation === true &&
      typeof idempotency.reserve === 'function';

    if (
      !this.config.financialOperationsRequireBoundary ||
      !this.transactionBoundary ||
      typeof this.transactionBoundary.execute !== 'function' ||
      !atomicFinancialProcessor ||
      !durableReservation
    ) {
      throw createServiceError(
        'Offline financial processing is disabled until the canonical transaction boundary, atomic event/receipt persistence, and durable idempotency reservation adapter are registered.',
        'OFFLINE_SYNC_FINANCIAL_AUTHORIZATION_REQUIRED',
        503,
      );
    }

    const result = await this.transactionBoundary.execute(
      async ({ session }) => financial.processOfflineEventAtomically(event, {
        ...context,
        session,
        offlineEventModel: this.OfflineEvent,
        offlineDeviceModel: this.OfflineDevice,
        syncCursorModel: this.SyncCursor,
        idempotencyStore: idempotency,
        receiptService: this.receiptService,
        reconciliationService: this.reconciliationService,
      }),
      {
        operation: 'OFFLINE_SYNC_FINANCIAL_EVENT',
        tenantId: event.tenantId,
        deviceId: event.deviceId,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
      },
    );

    // The adapter owns the complete atomic outcome. A generic financial result
    // is not enough to let the orchestrator write event/receipt state later.
    if (
      !result ||
      result.atomicPersistenceComplete !== true ||
      !result.event ||
      !result.receipt
    ) {
      throw createServiceError(
        'The offline financial adapter did not return its required atomic event and receipt result.',
        'OFFLINE_SYNC_FINANCIAL_AUTHORIZATION_REQUIRED',
        503,
      );
    }

    return result;
  }

  // ===========================================================================
  // Persist Event
  // ===========================================================================

  async persistEvent(
    event,
    {
      session = null,
      financialResult = null,
    } = {},
  ) {
    if (
      !this.OfflineEvent
    ) {
      return event;
    }

    const document = {
      ...event,

      syncVersion:
        SYNC_VERSION,

      synchronizedAt:
        new Date(),

      financialResult:
        financialResult || null,
    };

    try {
      if (
        typeof this.OfflineEvent.create ===
        'function'
      ) {
        const created =
          await this.OfflineEvent.create(
            [document],
            session
              ? {
                  session,
                }
              : undefined,
          );

        return Array.isArray(
          created,
        )
          ? created[0]
          : created;
      }

      return document;
    } catch (error) {
      if (
        error?.code === 11000
      ) {
        const existing =
          await this.findExistingEvent(
            event,
            {
              session,
            },
          );

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  // ===========================================================================
  // Receipt
  // ===========================================================================

  async generateReceipt(
    event,
    {
      financialResult = null,
      session = null,
    } = {},
  ) {
    if (
      !this.receiptService ||
      typeof this.receiptService
        .generateFromEvent !==
        'function'
    ) {
      return null;
    }

    const result =
      await this.receiptService
        .generateFromEvent({
          event,

          transactionId:
            financialResult
              ?.transactionId ||
            financialResult
              ?.transaction
              ?.transactionId ||
            null,

          reference:
            financialResult
              ?.reference ||
            null,

          amount:
            event.amount ??
            financialResult?.amount ??
            null,

          currency:
            event.currency ??
            financialResult?.currency ??
            null,

          memberId:
            event.memberId ||
            null,

          accountId:
            event.accountId ||
            null,

          meetingId:
            event.meetingId ||
            null,

          session,
        });

    return result;
  }

  // ===========================================================================
  // Single Event Processing
  // ===========================================================================

  async processEvent(
    event,
    context = {},
  ) {
    const validatedEvent =
      this.validateEvent(
        event,
        context,
      );

    /*
     * Idempotency check must happen before executing a financial operation.
     */
    if (
      validatedEvent.idempotencyKey
    ) {
      const existingResult =
        await this.getIdempotentResult(
          {
            tenantId:
              validatedEvent.tenantId,

            idempotencyKey:
              validatedEvent.idempotencyKey,
          },
        );

      if (existingResult) {
        return {
          ...existingResult,

          duplicate:
            true,

          idempotent:
            true,
        };
      }
    }

    const existingEvent =
      await this.findExistingEvent(
        validatedEvent,
      );

    if (existingEvent) {
      const conflict =
        await this.detectConflict(
          validatedEvent,
          existingEvent,
        );

      if (
        conflict.conflict
      ) {
        throw createServiceError(
          'Offline event conflicts with an existing event.',
          'OFFLINE_SYNC_EVENT_CONFLICT',
          409,
          {
            eventId:
              validatedEvent.eventId,

            reason:
              conflict.reason,
          },
        );
      }

      const duplicateResult = {
        status:
          'DUPLICATE',

        eventId:
          validatedEvent.eventId,

        event:
          existingEvent,

        receipt:
          null,

        duplicate:
          true,

        idempotent:
          true,
      };

      if (
        validatedEvent.idempotencyKey
      ) {
        await this.saveIdempotentResult(
          {
            tenantId:
              validatedEvent.tenantId,

            idempotencyKey:
              validatedEvent.idempotencyKey,

            result:
              duplicateResult,
          },
        );
      }

      return duplicateResult;
    }

    /*
     * Domain operations must be applied before a non-financial event is
     * acknowledged. Meeting minutes drafts use the canonical meeting model's
     * atomic revision + operation-ID guard; unsupported meeting operations are
     * rejected instead of being stored as though their business effect ran.
     * Financial events remain delegated to the established transaction boundary.
     */
    let domainResult = null;
    if (validatedEvent.eventType === 'MEETING_UPDATED') {
      if (validatedEvent.payload?.operation !== 'MINUTES_DRAFTED') {
        throw createServiceError(
          'This offline meeting operation is not supported.',
          'MEETING_OFFLINE_OPERATION_UNSUPPORTED',
          422,
          { eventId: validatedEvent.eventId },
        );
      }
      const actorId = context.actorId || context.userId;
      if (!actorId || !validatedEvent.userId || String(validatedEvent.userId) !== String(actorId)) {
        throw createServiceError(
          'Offline meeting draft actor does not match the authenticated user.',
          'OFFLINE_SYNC_ACTOR_MISMATCH',
          403,
          { eventId: validatedEvent.eventId },
        );
      }
      let handler = this.domainEventHandlers.MEETING_UPDATED;
      if (typeof handler !== 'function') {
        try {
          const meetingService = await import('../../meetings/meeting.service.js');
          handler = meetingService.applyOfflineMeetingDraft;
        } catch {
          throw createServiceError(
            'Offline meeting draft processing is unavailable.',
            'OFFLINE_MEETING_HANDLER_NOT_CONFIGURED',
            503,
            { eventId: validatedEvent.eventId },
          );
        }
      }
      if (typeof handler !== 'function') {
        throw createServiceError(
          'Offline meeting draft processing is not configured.',
          'OFFLINE_MEETING_HANDLER_NOT_CONFIGURED',
          503,
          { eventId: validatedEvent.eventId },
        );
      }
      domainResult = await handler(validatedEvent, {
        tenantId: validatedEvent.tenantId,
        actorId: String(actorId),
        requestId: context.requestId || null,
        correlationId: context.correlationId || context.requestId || null,
      });
    }

    const financialResult =
      await this.processFinancialEvent(
        validatedEvent,
        context,
      );

    const isAtomicFinancialResult =
      Boolean(
        financialResult?.atomicPersistenceComplete === true &&
        isFinancialEvent(validatedEvent),
      );

    const persistedEvent = isAtomicFinancialResult
      ? financialResult.event
      : await this.persistEvent(validatedEvent, {
          session: context.session || null,
          financialResult,
          domainResult,
        });

    const receipt = isAtomicFinancialResult
      ? financialResult.receipt
      : await this.generateReceipt(persistedEvent, {
          financialResult,
          domainResult,
          session: context.session || null,
        });

    const result = {
      status:
        'ACCEPTED',

      eventId:
        validatedEvent.eventId,

      event:
        persistedEvent,

      financialResult,
      domainResult,

      receipt:
        receipt?.receipt ||
        receipt ||
        null,

      duplicate:
        false,

      idempotent:
        false,
    };

    // The atomic financial adapter writes its idempotency result inside the
    // same authoritative transaction; never create a post-commit second write.
    if (
      validatedEvent.idempotencyKey &&
      !isAtomicFinancialResult
    ) {
      await this.saveIdempotentResult({
        tenantId: validatedEvent.tenantId,
        idempotencyKey: validatedEvent.idempotencyKey,
        result,
      });
    }

    await this._audit(
      'EVENT_SYNCHRONIZED',
      {
        tenantId:
          validatedEvent.tenantId,

        deviceId:
          validatedEvent.deviceId,

        eventId:
          validatedEvent.eventId,

        operationType:
          validatedEvent.eventType,

        financial:
          isFinancialEvent(
            validatedEvent,
          ),
      },
    );

    return result;
  }

  // ===========================================================================
  // Batch Synchronization
  // ===========================================================================

  async synchronize(
    request,
  ) {
    const syncRequest =
      this.validateSyncRequest(
        request,
      );

    const startedAt =
      Date.now();

    const operationId =
      syncRequest.syncRequestId;

    await this._audit(
      'SYNC_STARTED',
      {
        operationId,

        tenantId:
          syncRequest.tenantId,

        deviceId:
          syncRequest.deviceId,

        eventCount:
          syncRequest.events.length,
      },
    );

    /*
     * Device authorization occurs before processing any event.
     */
    const device =
      await this.validateDevice(
        {
          tenantId:
            syncRequest.tenantId,

          deviceId:
            syncRequest.deviceId,

          deviceToken:
            syncRequest.deviceToken,

          deviceSignature:
            syncRequest.deviceSignature,

          deviceFingerprint:
            syncRequest.deviceFingerprint,

          deviceKeyId:
            syncRequest.deviceKeyId,
        },
      );

    const validatedEvents =
      syncRequest.events.map(
        (event) =>
          this.validateEvent(
            event,
            syncRequest,
          ),
      );

    this.validateBatchOrdering(
      validatedEvents,
    );

    const results = [];

    const failures = [];
    const {
      deviceToken: _deviceToken,
      deviceFingerprint: _deviceFingerprint,
      deviceKeyId: _deviceKeyId,
      deviceSignature: _deviceSignature,
      request: _httpRequest,
      ...safeSyncContext
    } = syncRequest;

    /*
     * We intentionally process events sequentially.
     *
     * Offline event streams may represent an ordered local history. Parallel
     * execution can violate sequence semantics and can create races around
     * financial state.
     */
    for (
      let index = 0;
      index <
      validatedEvents.length;
      index += 1
    ) {
      const event =
        validatedEvents[index];

      try {
        const result =
          await this.executeWithRetry(
            () =>
              this.processEvent(
                event,
                {
                  ...safeSyncContext,

                  operationId,

                  device,

                  batchIndex:
                    index,
                },
              ),
            {
              operationId,

              eventId:
                event.eventId,
            },
          );

        results.push(
          result,
        );
      } catch (error) {
        const failure = {
          status:
            'FAILED',

          eventId:
            event.eventId,

          index,

          code:
            error.code ||
            'OFFLINE_SYNC_EVENT_FAILED',

          message:
            error.message,

          retryable:
            isRetryableError(
              error,
            ),
        };

        failures.push(
          failure,
        );

        /*
         * Continue processing independent events so that one malformed or
         * conflicted event does not necessarily destroy the complete batch.
         *
         * Financial transaction atomicity is still enforced per event.
         */
        this._log(
          'warn',
          'Offline event synchronization failed.',
          {
            operationId,

            eventId:
              event.eventId,

            code:
              failure.code,
          },
        );
      }
    }

    const cursor =
      await this.advanceCursor(
        {
          tenantId:
            syncRequest.tenantId,

          deviceId:
            syncRequest.deviceId,

          previousCursor:
            syncRequest.cursor,

          results,

          events:
            validatedEvents,
        },
      );

    const durationMs =
      Date.now() -
      startedAt;

    const response = {
      syncVersion:
        SYNC_VERSION,

      operationId,

      tenantId:
        syncRequest.tenantId,

      deviceId:
        syncRequest.deviceId,

      status:
        failures.length === 0
          ? 'COMPLETED'
          : results.length > 0
            ? 'PARTIAL'
            : 'FAILED',

      accepted:
        results.filter(
          (result) =>
            result.status ===
            'ACCEPTED',
        ).length,

      duplicate:
        results.filter(
          (result) =>
            result.status ===
            'DUPLICATE',
        ).length,

      failed:
        failures.length,

      results,

      failures,

      cursor,

      hasMore:
        failures.length > 0,

      durationMs,

      synchronizedAt:
        new Date(),
    };

    await this._audit(
      'SYNC_COMPLETED',
      {
        operationId,

        tenantId:
          syncRequest.tenantId,

        deviceId:
          syncRequest.deviceId,

        accepted:
          response.accepted,

        duplicate:
          response.duplicate,

        failed:
          response.failed,

        durationMs,
      },
    );

    return response;
  }

  // ===========================================================================
  // Retry Wrapper
  // ===========================================================================

  async executeWithRetry(
    operation,
    {
      operationId = null,
      eventId = null,
      maxRetries =
        this.config.maxRetries,
    } = {},
  ) {
    let attempt = 0;

    while (
      true
    ) {
      attempt += 1;

      try {
        return await operation();
      } catch (error) {
        const retryable =
          isRetryableError(
            error,
          );

        if (
          !retryable ||
          attempt >
            maxRetries
        ) {
          throw error;
        }

        const delay =
          calculateBackoff(
            attempt,
            this.config
              .retryDelayMs,

            this.config
              .maxRetryDelayMs,
          );

        this._log(
          'warn',
          'Retrying offline synchronization operation.',
          {
            operationId,

            eventId,

            attempt,

            maxRetries,

            delay,

            error:
              error.message,
          },
        );

        await sleep(
          delay,
        );
      }
    }
  }

  // ===========================================================================
  // Cursor Management
  // ===========================================================================

  buildCursor(
    {
      tenantId,
      deviceId,
      lastSequence,
      lastEventId,
    },
  ) {
    const payload = {
      version:
        SYNC_VERSION,

      tenantId,

      deviceId,

      lastSequence:
        lastSequence ??
        null,

      lastEventId:
        lastEventId ||
        null,
    };

    const encoded =
      Buffer.from(
        JSON.stringify(
          payload,
        ),
        'utf8',
      ).toString(
        'base64url',
      );

    return `TSC_${encoded}`;
  }

  parseCursor(
    cursor,
  ) {
    if (
      !cursor
    ) {
      return null;
    }

    const normalized =
      requireString(
        cursor,
        'cursor',
        MAX_CURSOR_LENGTH,
      );

    if (
      !normalized.startsWith(
        'TSC_',
      )
    ) {
      throw createServiceError(
        'Invalid offline synchronization cursor.',
        'OFFLINE_SYNC_CURSOR_INVALID',
        400,
      );
    }

    try {
      const encoded =
        normalized.slice(4);

      const decoded =
        Buffer.from(
          encoded,
          'base64url',
        ).toString(
          'utf8',
        );

      const payload =
        JSON.parse(
          decoded,
        );

      if (
        payload.version !==
        SYNC_VERSION
      ) {
        throw new Error(
          'Unsupported cursor version.',
        );
      }

      return payload;
    } catch {
      throw createServiceError(
        'Invalid offline synchronization cursor.',
        'OFFLINE_SYNC_CURSOR_INVALID',
        400,
      );
    }
  }

  async getCurrentCursor(
    {
      tenantId,
      deviceId,
    },
  ) {
    if (
      !this.SyncCursor
    ) {
      return null;
    }

    return this.SyncCursor
      .findOne({
        tenantId,

        deviceId,
      })
      .lean()
      .exec();
  }

  async advanceCursor({
    tenantId,
    deviceId,
    previousCursor = null,
    results = [],
    events = [],
  }) {
    const parsedPrevious =
      this.parseCursor(
        previousCursor,
      );

    let lastSequence =
      parsedPrevious
        ?.lastSequence ??
      null;

    let lastEventId =
      parsedPrevious
        ?.lastEventId ??
      null;

    for (
      const result of results
    ) {
      const event =
        events.find(
          (candidate) =>
            candidate.eventId ===
            result.eventId,
        );

      if (!event) {
        continue;
      }

      if (
        event.sequenceNumber !==
        null
      ) {
        if (
          lastSequence ===
            null ||
          event.sequenceNumber >
            lastSequence
        ) {
          lastSequence =
            event.sequenceNumber;

          lastEventId =
            event.eventId;
        }
      } else {
        lastEventId =
          event.eventId;
      }
    }

    const cursor =
      this.buildCursor({
        tenantId,

        deviceId,

        lastSequence,

        lastEventId,
      });

    if (
      this.SyncCursor
    ) {
      await this.SyncCursor.findOneAndUpdate(
        {
          tenantId,

          deviceId,
        },

        {
          $set: {
            tenantId,

            deviceId,

            cursor,

            lastSequence,

            lastEventId,

            updatedAt:
              new Date(),
          },
        },

        {
          upsert:
            true,

          new:
            true,
        },
      ).exec();
    }

    return {
      cursor,

      lastSequence,

      lastEventId,
    };
  }

  // ===========================================================================
  // Pull / Downstream Synchronization
  // ===========================================================================

  async pullEvents({
    tenantId,
    deviceId,
    cursor = null,
    limit =
      this.config.defaultBatchSize,
  }) {
    if (
      !this.OfflineEvent
    ) {
      return {
        events: [],

        cursor,
        hasMore: false,
      };
    }

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 100,
          1,
        ),
        this.config.maxBatchSize,
      );

    const parsedCursor =
      this.parseCursor(
        cursor,
      );

    const query = {
      tenantId,
    };

    if (
      parsedCursor?.lastSequence !==
      null &&
      parsedCursor?.lastSequence !==
        undefined
    ) {
      query.sequenceNumber = {
        $gt:
          parsedCursor.lastSequence,
      };
    }

    const events =
      await this.OfflineEvent
        .find(query)
        .sort({
          sequenceNumber:
            1,

          createdAt:
            1,
        })
        .limit(
          safeLimit + 1,
        )
        .lean()
        .exec();

    const hasMore =
      events.length >
      safeLimit;

    const page =
      hasMore
        ? events.slice(
            0,
            safeLimit,
          )
        : events;

    let nextCursor =
      cursor;

    if (
      page.length > 0
    ) {
      const last =
        page[
          page.length - 1
        ];

      nextCursor =
        this.buildCursor({
          tenantId,

          deviceId,

          lastSequence:
            last.sequenceNumber ??
            parsedCursor?.lastSequence ??
            null,

          lastEventId:
            last.eventId,
        });
    }

    return {
      events:
        page,

      cursor:
        nextCursor,

      hasMore,
    };
  }

  // ===========================================================================
  // Reconciliation
  // ===========================================================================

  async reconcile(
    {
      tenantId,
      deviceId,
      eventIds = [],
    },
  ) {
    if (
      !this.reconciliationService ||
      typeof this.reconciliationService
        .reconcile !==
        'function'
    ) {
      return {
        status:
          'NOT_CONFIGURED',

        reconciled:
          0,

        conflicts:
          0,
      };
    }

    const result =
      await this.reconciliationService
        .reconcile({
          tenantId,

          deviceId,

          eventIds,
        });

    await this._audit(
      'RECONCILIATION_COMPLETED',
      {
        tenantId,

        deviceId,

        eventCount:
          eventIds.length,
      },
    );

    return result;
  }

  // ===========================================================================
  // Health / Readiness
  // ===========================================================================

  readiness() {
    const idempotency = this.idempotencyStore;
    const financial = this.financialService;
    const checks = {
      offlineEventModel: Boolean(this.OfflineEvent),
      offlineDeviceModel: Boolean(this.OfflineDevice),
      syncCursor: Boolean(this.SyncCursor),
      durableIdempotencyReservation: Boolean(
        idempotency &&
        idempotency.isDurable === true &&
        idempotency.supportsAtomicFinancialReservation === true &&
        typeof idempotency.reserve === 'function' &&
        typeof idempotency.get === 'function' &&
        typeof idempotency.set === 'function',
      ),
      receiptService: Boolean(
        this.receiptService &&
        typeof this.receiptService.generateFromEvent === 'function',
      ),
      offlineDeviceService: Boolean(
        this.offlineDeviceService &&
        typeof this.offlineDeviceService.authenticateDevice === 'function' &&
        typeof this.offlineDeviceService.validateDevice === 'function' &&
        typeof this.offlineDeviceService.validateEventIntegrity === 'function' &&
        typeof this.offlineDeviceService.verifyEventSignature === 'function',
      ),
      transactionBoundary: Boolean(
        this.transactionBoundary &&
        typeof this.transactionBoundary.execute === 'function',
      ),
      atomicOfflineFinancialProcessor: Boolean(
        financial &&
        financial.supportsAtomicOfflineSync === true &&
        financial.persistsOfflineEventAtomically === true &&
        financial.persistsReceiptAtomically === true &&
        financial.usesDurableIdempotency === true &&
        typeof financial.processOfflineEventAtomically === 'function',
      ),
      reconciliationService: Boolean(this.reconciliationService),
    };
    const blockers = Object.entries(checks)
      .filter(([, configured]) => !configured)
      .map(([name]) => name);
    return {
      service: SERVICE_NAME,
      version: SYNC_VERSION,
      ready: blockers.length === 0,
      status: blockers.length === 0 ? 'READY' : 'NOT_READY',
      blockers,
      dependencies: checks,
    };
  }

  ready() {
    return this.readiness().ready;
  }

  health() {
    const readiness = this.readiness();
    return {
      ...readiness,
      configuration: {
        maxBatchSize: this.config.maxBatchSize,
        maxRetries: this.config.maxRetries,
        requireDeviceRegistration: this.config.requireDeviceRegistration,
        requireEventHash: this.config.requireEventHash,
        financialOperationsRequireBoundary: this.config.financialOperationsRequireBoundary,
      },
    };
  }
}

// =============================================================================
// Singleton
// =============================================================================

const offlineSyncService =
  new OfflineSyncService();

// =============================================================================
// Exports
// =============================================================================

export {
  OfflineSyncService,
  SERVICE_NAME,
  SYNC_VERSION,
};

export default offlineSyncService;