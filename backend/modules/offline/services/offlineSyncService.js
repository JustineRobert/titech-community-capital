'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
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

const crypto = require('crypto');

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

      requireDeviceRegistration:
        config.requireDeviceRegistration !==
        false,

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

    const hashPayload = {
      ...event,
    };

    delete hashPayload.eventHash;

    const calculatedEventHash =
      hashEvent(
        hashPayload,
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
    },
  ) {
    if (
      !this.config
        .requireDeviceRegistration
    ) {
      return {
        valid: true,

        deviceId,

        tenantId,
      };
    }

    if (
      this.offlineDeviceService &&
      typeof this.offlineDeviceService
        .validateDevice ===
        'function'
    ) {
      const result =
        await this.offlineDeviceService
          .validateDevice({
            tenantId,
            deviceId,
            deviceToken,
            deviceSignature,
          });

      if (
        result === false ||
        result?.valid === false
      ) {
        throw createServiceError(
          'Offline device authorization failed.',
          'OFFLINE_SYNC_DEVICE_INVALID',
          403,
        );
      }

      if (
        result?.revoked
      ) {
        throw createServiceError(
          'Offline device has been revoked.',
          'OFFLINE_SYNC_DEVICE_REVOKED',
          403,
        );
      }

      return result;
    }

    if (
      this.OfflineDevice
    ) {
      const device =
        await this.OfflineDevice.findOne({
          tenantId,

          deviceId,
        }).lean();

      if (!device) {
        throw createServiceError(
          'Offline device is not registered.',
          'OFFLINE_SYNC_DEVICE_INVALID',
          403,
        );
      }

      if (
        device.status ===
          'REVOKED' ||
        device.revoked ===
          true
      ) {
        throw createServiceError(
          'Offline device has been revoked.',
          'OFFLINE_SYNC_DEVICE_REVOKED',
          403,
        );
      }

      if (
        device.status ===
          'SUSPENDED'
      ) {
        throw createServiceError(
          'Offline device is suspended.',
          'OFFLINE_SYNC_DEVICE_INVALID',
          403,
        );
      }

      return {
        valid: true,

        device,
      };
    }

    /*
     * Fail closed when device registration is required but no authorization
     * mechanism has been configured.
     */
    throw createServiceError(
      'Offline device authorization is not configured.',
      'OFFLINE_SYNC_DEVICE_INVALID',
      503,
    );
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
    if (
      !isFinancialEvent(
        event,
      )
    ) {
      return null;
    }

    if (
      !this.config
        .financialOperationsRequireBoundary
    ) {
      if (
        this.financialService &&
        typeof this.financialService
          .processOfflineEvent ===
          'function'
      ) {
        return this.financialService
          .processOfflineEvent(
            event,
            context,
          );
      }

      return null;
    }

    if (
      !this.transactionBoundary
    ) {
      throw createServiceError(
        'Financial offline synchronization requires the TITech transaction boundary.',
        'OFFLINE_SYNC_FINANCIAL_AUTHORIZATION_REQUIRED',
        503,
      );
    }

    if (
      typeof this.transactionBoundary
        .execute !==
      'function'
    ) {
      throw createServiceError(
        'TITech financial transaction boundary is not correctly configured.',
        'OFFLINE_SYNC_FINANCIAL_AUTHORIZATION_REQUIRED',
        503,
      );
    }

    return this.transactionBoundary.execute(
      async ({
        session,
      }) => {
        if (
          this.financialService &&
          typeof this.financialService
            .processOfflineEvent ===
            'function'
        ) {
          return this.financialService
            .processOfflineEvent(
              event,
              {
                ...context,

                session,
              },
            );
        }

        throw createServiceError(
          'No financial offline event processor is configured.',
          'OFFLINE_SYNC_FINANCIAL_AUTHORIZATION_REQUIRED',
          503,
        );
      },
      {
        operation:
          'OFFLINE_SYNC_FINANCIAL_EVENT',

        tenantId:
          event.tenantId,

        deviceId:
          event.deviceId,

        eventId:
          event.eventId,

        idempotencyKey:
          event.idempotencyKey,
      },
    );
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
     * Financial events are deliberately delegated to the transaction boundary.
     * Non-financial events can be persisted directly.
     */
    const financialResult =
      await this.processFinancialEvent(
        validatedEvent,
        context,
      );

    const persistedEvent =
      await this.persistEvent(
        validatedEvent,
        {
          session:
            context.session ||
            null,

          financialResult,
        },
      );

    const receipt =
      await this.generateReceipt(
        persistedEvent,
        {
          financialResult,

          session:
            context.session ||
            null,
        },
      );

    const result = {
      status:
        'ACCEPTED',

      eventId:
        validatedEvent.eventId,

      event:
        persistedEvent,

      financialResult,

      receipt:
        receipt?.receipt ||
        receipt ||
        null,

      duplicate:
        false,

      idempotent:
        false,
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

          result,
        },
      );
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
                  ...syncRequest,

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

  health() {
    return {
      service:
        SERVICE_NAME,

      version:
        SYNC_VERSION,

      status:
        'READY',

      dependencies: {
        offlineEventModel:
          Boolean(
            this.OfflineEvent,
          ),

        offlineDeviceModel:
          Boolean(
            this.OfflineDevice,
          ),

        syncCursor:
          Boolean(
            this.SyncCursor,
          ),

        idempotencyStore:
          Boolean(
            this.idempotencyStore,
          ),

        receiptService:
          Boolean(
            this.receiptService,
          ),

        transactionBoundary:
          Boolean(
            this.transactionBoundary,
          ),

        financialService:
          Boolean(
            this.financialService,
          ),

        reconciliationService:
          Boolean(
            this.reconciliationService,
          ),
      },

      configuration: {
        maxBatchSize:
          this.config
            .maxBatchSize,

        maxRetries:
          this.config
            .maxRetries,

        requireDeviceRegistration:
          this.config
            .requireDeviceRegistration,

        requireEventHash:
          this.config
            .requireEventHash,

        financialOperationsRequireBoundary:
          this.config
            .financialOperationsRequireBoundary,
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

module.exports =
  offlineSyncService;

module.exports.OfflineSyncService =
  OfflineSyncService;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.SYNC_VERSION =
  SYNC_VERSION;