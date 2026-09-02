'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Event Publisher
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/workflows/paymentEventPublisher.js
 *
 * Purpose
 * -------
 * Enterprise event publication boundary for the Payment domain.
 *
 * This module translates authoritative payment lifecycle changes into durable,
 * versioned, correlation-aware domain events suitable for:
 *
 *   - TransactionEventPublisher
 *   - Outbox / Transactional Outbox
 *   - Event Bus
 *   - Message Queue / BullMQ
 *   - Notification workflows
 *   - Reconciliation workflows
 *   - Settlement workflows
 *   - Fraud / Risk workflows
 *   - Observability
 *   - Reporting / Analytics
 *
 * Architectural Rules
 * -------------------
 * 1. Payment events are emitted only from authoritative domain state.
 * 2. This publisher never mutates payment state.
 * 3. This publisher never posts ledger entries.
 * 4. This publisher never mutates account balances.
 * 5. Events contain stable identifiers, not secrets.
 * 6. Monetary values are serialized as decimal strings.
 * 7. Event names are versioned at the schema boundary.
 * 8. Events are tenant-scoped.
 * 9. Correlation / causation / request IDs are propagated.
 * 10. Event publication must be idempotent.
 * 11. Duplicate delivery must be safe for consumers.
 * 12. Exactly-once delivery is NOT assumed.
 * 13. Transactional outbox is preferred for production durability.
 * 14. Provider payloads are sanitized before publication.
 * 15. Event publication failures must not silently imply financial rollback.
 * 16. If an outbox is unavailable, strict mode can fail closed.
 *
 * Canonical Flow
 * --------------
 *
 *   PaymentStateMachine
 *          |
 *          v
 *   PaymentEventPublisher
 *          |
 *          v
 *   Transactional Outbox
 *          |
 *          v
 *   Event Bus / Queue
 *          |
 *       +--+--------------------------+
 *       |                             |
 *       v                             v
 * Finance / Settlement          Notifications / Risk
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Event Types
 * ========================================================================== */

const PAYMENT_EVENT_TYPES = Object.freeze({
  INITIATED:
    'PaymentInitiated',

  PENDING:
    'PaymentPending',

  PROCESSING:
    'PaymentProcessing',

  SUCCESSFUL:
    'PaymentCompleted',

  FAILED:
    'PaymentFailed',

  CANCELLED:
    'PaymentCancelled',

  REVERSED:
    'PaymentReversed',

  RETRYING:
    'PaymentRetrying',

  UNKNOWN:
    'PaymentOutcomeUnknown',

  REQUIRES_RECONCILIATION:
    'PaymentReconciliationRequired',

  EXPIRED:
    'PaymentExpired',

  DEAD_LETTERED:
    'PaymentDeadLettered',

  STATE_CHANGED:
    'PaymentStateChanged',

  PROVIDER_CALLBACK_RECEIVED:
    'PaymentProviderCallbackReceived',

  PROVIDER_STATUS_VERIFIED:
    'PaymentProviderStatusVerified',

  FINANCIAL_POSTING_STARTED:
    'PaymentFinancialPostingStarted',

  FINANCIAL_POSTED:
    'PaymentFinancialPosted',

  FINANCIAL_POSTING_FAILED:
    'PaymentFinancialPostingFailed',

  FINANCIAL_POSTING_UNKNOWN:
    'PaymentFinancialPostingUnknown',

  SETTLEMENT_INITIATED:
    'PaymentSettlementInitiated',

  SETTLEMENT_COMPLETED:
    'PaymentSettlementCompleted',

  SETTLEMENT_FAILED:
    'PaymentSettlementFailed',
});

const PAYMENT_EVENT_SCHEMA_VERSION = 1;

const PAYMENT_EVENT_SOURCES = Object.freeze({
  PAYMENT_STATE_MACHINE:
    'PaymentStateMachine',

  PAYMENT_PROCESSING_SERVICE:
    'PaymentProcessingService',

  PAYMENT_VERIFICATION_SERVICE:
    'PaymentVerificationService',

  GOLDEN_MONEY_PATH:
    'GoldenMoneyPathService',

  CALLBACK_PROCESSOR:
    'PaymentCallbackProcessor',

  FINANCIAL_POSTING:
    'FinancialPostingEngine',

  SETTLEMENT:
    'PaymentSettlementService',

  SYSTEM:
    'PaymentSystem',
});

const PAYMENT_EVENT_CATEGORIES = Object.freeze({
  LIFECYCLE:
    'PAYMENT_LIFECYCLE',

  PROVIDER:
    'PAYMENT_PROVIDER',

  FINANCIAL:
    'PAYMENT_FINANCIAL',

  SETTLEMENT:
    'PAYMENT_SETTLEMENT',

  RECONCILIATION:
    'PAYMENT_RECONCILIATION',
});

const EVENT_PUBLISH_STATUS = Object.freeze({
  PUBLISHED:
    'PUBLISHED',

  STORED:
    'STORED',

  DUPLICATE:
    'DUPLICATE',

  FAILED:
    'FAILED',

  SKIPPED:
    'SKIPPED',
});

const PAYMENT_EVENT_ERROR_CODES = Object.freeze({
  INVALID_EVENT:
    'PAYMENT_EVENT_INVALID',

  PAYMENT_ID_REQUIRED:
    'PAYMENT_EVENT_PAYMENT_ID_REQUIRED',

  TENANT_ID_REQUIRED:
    'PAYMENT_EVENT_TENANT_ID_REQUIRED',

  EVENT_TYPE_REQUIRED:
    'PAYMENT_EVENT_TYPE_REQUIRED',

  INVALID_EVENT_TYPE:
    'PAYMENT_EVENT_INVALID_TYPE',

  VERSION_REQUIRED:
    'PAYMENT_EVENT_VERSION_REQUIRED',

  CORRELATION_REQUIRED:
    'PAYMENT_EVENT_CORRELATION_REQUIRED',

  DUPLICATE_EVENT:
    'PAYMENT_EVENT_DUPLICATE',

  OUTBOX_UNAVAILABLE:
    'PAYMENT_EVENT_OUTBOX_UNAVAILABLE',

  PUBLISHER_UNAVAILABLE:
    'PAYMENT_EVENT_PUBLISHER_UNAVAILABLE',

  SERIALIZATION_FAILED:
    'PAYMENT_EVENT_SERIALIZATION_FAILED',

  STORAGE_FAILED:
    'PAYMENT_EVENT_STORAGE_FAILED',

  PUBLISH_FAILED:
    'PAYMENT_EVENT_PUBLISH_FAILED',

  INVALID_TENANT:
    'PAYMENT_EVENT_INVALID_TENANT',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode:
    true,

  requireTenant:
    true,

  requireCorrelationId:
    false,

  requireCausationId:
    false,

  requireRequestId:
    false,

  requireEventId:
    true,

  useTransactionalOutbox:
    true,

  publishImmediately:
    false,

  allowDirectPublisherFallback:
    false,

  failOnPublicationError:
    true,

  deduplicateEvents:
    true,

  /**
   * Do not publish full provider payloads.
   */
  includeProviderMetadata:
    true,

  /**
   * Raw provider callbacks should never be emitted.
   */
  includeRawProviderPayload:
    false,

  /**
   * Event consumers should have stable amount/currency values.
   */
  serializeAmountAsString:
    true,

  /**
   * Prevent excessively large metadata payloads.
   */
  maxMetadataDepth:
    8,

  maxMetadataKeys:
    100,

  maxMetadataStringLength:
    5000,

  /**
   * Event IDs are UUID-backed and unique. Aggregate sequence is independently
   * carried through aggregateVersion.
   */
  eventIdPrefix:
    'evt',

  eventSource:
    PAYMENT_EVENT_SOURCES.SYSTEM,

  environment:
    process.env.NODE_ENV ||
    'development',
});

/* ============================================================================
 * Error
 * ========================================================================== */

class PaymentEventPublisherError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name =
      'PaymentEventPublisherError';

    this.code =
      options.code ||
      PAYMENT_EVENT_ERROR_CODES.INVALID_EVENT;

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 500;

    this.paymentId =
      options.paymentId ||
      null;

    this.tenantId =
      options.tenantId ||
      null;

    this.eventId =
      options.eventId ||
      null;

    this.eventType =
      options.eventType ||
      null;

    this.aggregateVersion =
      options.aggregateVersion ??
      null;

    this.retryable =
      options.retryable === true;

    this.details =
      options.details ||
      {};

    if (options.cause) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      PaymentEventPublisherError,
    );
  }
}

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function isNonEmptyString(
  value,
) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function normalizeString(
  value,
) {
  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

function normalizeProvider(
  value,
) {
  const provider =
    normalizeString(value);

  return provider
    ? provider.toLowerCase()
    : null;
}

function normalizeStatus(
  value,
) {
  const status =
    normalizeString(value);

  return status
    ? status.toUpperCase()
    : null;
}

function normalizeAmount(
  value,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return String(value);
  }

  if (
    value &&
    typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return null;
}

function canonicalAmount(
  value,
) {
  const amount =
    normalizeAmount(value);

  if (!amount) {
    return null;
  }

  const trimmed =
    amount.trim();

  if (
    !/^\d+(\.\d+)?$/.test(
      trimmed,
    )
  ) {
    return null;
  }

  const parts =
    trimmed.split('.');

  const integerPart =
    parts[0].replace(
      /^0+(?=\d)/,
      '',
    );

  const decimalPart =
    parts[1]
      ? parts[1].replace(
        /0+$/,
        '',
      )
      : '';

  return decimalPart
    ? `${integerPart}.${decimalPart}`
    : integerPart;
}

function canonicalCurrency(
  value,
) {
  const currency =
    normalizeString(value);

  return currency
    ? currency.toUpperCase()
    : null;
}

function safeId(
  value,
) {
  if (
    value &&
    typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return normalizeString(value);
}

function parseVersion(
  value,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed,
    ) ||
    parsed < 0
  ) {
    return null;
  }

  return parsed;
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function clone(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (
    typeof structuredClone ===
    'function'
  ) {
    try {
      return structuredClone(
        value,
      );
    } catch (_error) {
      // Fall through.
    }
  }

  try {
    return JSON.parse(
      JSON.stringify(value),
    );
  } catch (_error) {
    return value;
  }
}

function stableStringify(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return String(value);
  }

  if (
    typeof value !== 'object'
  ) {
    return JSON.stringify(
      value,
    );
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(
          key,
        )}:${stableStringify(
          value[key],
        )}`,
    )
    .join(',')}}`;
}

function sha256(
  value,
) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(
          value,
        ),
    )
    .digest('hex');
}

function createEventId(
  prefix,
) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createCorrelationId() {
  return `corr_${crypto.randomUUID()}`;
}

function createEventKey(
  event,
) {
  return [
    event.tenantId,
    event.eventType,
    event.aggregateType,
    event.aggregateId,
    event.aggregateVersion,
  ].join(':');
}

/* ============================================================================
 * Event Type Mapping
 * ========================================================================== */

function eventTypeForPaymentState(
  state,
) {
  const normalized =
    normalizeStatus(state);

  switch (normalized) {
    case 'INITIATED':
      return PAYMENT_EVENT_TYPES.INITIATED;

    case 'PENDING':
      return PAYMENT_EVENT_TYPES.PENDING;

    case 'PROCESSING':
      return PAYMENT_EVENT_TYPES.PROCESSING;

    case 'SUCCESSFUL':
      return PAYMENT_EVENT_TYPES.SUCCESSFUL;

    case 'FAILED':
      return PAYMENT_EVENT_TYPES.FAILED;

    case 'CANCELLED':
      return PAYMENT_EVENT_TYPES.CANCELLED;

    case 'REVERSED':
      return PAYMENT_EVENT_TYPES.REVERSED;

    case 'RETRYING':
      return PAYMENT_EVENT_TYPES.RETRYING;

    case 'UNKNOWN':
      return PAYMENT_EVENT_TYPES.UNKNOWN;

    case 'REQUIRES_RECONCILIATION':
      return PAYMENT_EVENT_TYPES
        .REQUIRES_RECONCILIATION;

    case 'EXPIRED':
      return PAYMENT_EVENT_TYPES.EXPIRED;

    case 'DEAD_LETTER':
      return PAYMENT_EVENT_TYPES.DEAD_LETTERED;

    default:
      return PAYMENT_EVENT_TYPES.STATE_CHANGED;
  }
}

function categoryForEventType(
  eventType,
) {
  if (
    [
      PAYMENT_EVENT_TYPES
        .INITIATED,
      PAYMENT_EVENT_TYPES
        .PENDING,
      PAYMENT_EVENT_TYPES
        .PROCESSING,
      PAYMENT_EVENT_TYPES
        .SUCCESSFUL,
      PAYMENT_EVENT_TYPES
        .FAILED,
      PAYMENT_EVENT_TYPES
        .CANCELLED,
      PAYMENT_EVENT_TYPES
        .REVERSED,
      PAYMENT_EVENT_TYPES
        .RETRYING,
      PAYMENT_EVENT_TYPES
        .UNKNOWN,
      PAYMENT_EVENT_TYPES
        .REQUIRES_RECONCILIATION,
      PAYMENT_EVENT_TYPES
        .EXPIRED,
      PAYMENT_EVENT_TYPES
        .DEAD_LETTERED,
      PAYMENT_EVENT_TYPES
        .STATE_CHANGED,
    ].includes(eventType)
  ) {
    return PAYMENT_EVENT_CATEGORIES
      .LIFECYCLE;
  }

  if (
    [
      PAYMENT_EVENT_TYPES
        .PROVIDER_CALLBACK_RECEIVED,
      PAYMENT_EVENT_TYPES
        .PROVIDER_STATUS_VERIFIED,
    ].includes(eventType)
  ) {
    return PAYMENT_EVENT_CATEGORIES
      .PROVIDER;
  }

  if (
    [
      PAYMENT_EVENT_TYPES
        .FINANCIAL_POSTING_STARTED,
      PAYMENT_EVENT_TYPES
        .FINANCIAL_POSTED,
      PAYMENT_EVENT_TYPES
        .FINANCIAL_POSTING_FAILED,
      PAYMENT_EVENT_TYPES
        .FINANCIAL_POSTING_UNKNOWN,
    ].includes(eventType)
  ) {
    return PAYMENT_EVENT_CATEGORIES
      .FINANCIAL;
  }

  if (
    [
      PAYMENT_EVENT_TYPES
        .SETTLEMENT_INITIATED,
      PAYMENT_EVENT_TYPES
        .SETTLEMENT_COMPLETED,
      PAYMENT_EVENT_TYPES
        .SETTLEMENT_FAILED,
    ].includes(eventType)
  ) {
    return PAYMENT_EVENT_CATEGORIES
      .SETTLEMENT;
  }

  return PAYMENT_EVENT_CATEGORIES
    .RECONCILIATION;
}

/* ============================================================================
 * Payment Event Publisher
 * ========================================================================== */

class PaymentEventPublisher {
  /**
   * @param {Object} dependencies
   *
   * @param {Object} dependencies.outboxRepository
   * @param {Object} dependencies.eventPublisher
   * @param {Object} dependencies.transactionEventPublisher
   * @param {Object} dependencies.auditService
   * @param {Object} dependencies.metrics
   * @param {Object} dependencies.logger
   */
  constructor(
    dependencies = {},
  ) {
    this.outboxRepository =
      dependencies.outboxRepository ||
      dependencies.eventOutboxRepository ||
      null;

    this.eventPublisher =
      dependencies.eventPublisher ||
      null;

    this.transactionEventPublisher =
      dependencies.transactionEventPublisher ||
      null;

    this.auditService =
      dependencies.auditService ||
      null;

    this.metrics =
      dependencies.metrics ||
      null;

    this.logger =
      dependencies.logger ||
      console;

    this.options =
      Object.freeze({
        ...DEFAULT_OPTIONS,
        ...(dependencies.options || {}),
      });
  }

  /* ==========================================================================
   * Primary Publication API
   * ======================================================================== */

  /**
   * Publish a normalized payment event.
   *
   * Production preference:
   *
   *   create event
   *      ->
   *   persist transactional outbox
   *      ->
   *   outbox worker publishes
   *
   * The method therefore defaults to durable outbox persistence rather than
   * direct synchronous event bus publication.
   */
  async publish(
    input = {},
  ) {
    const event =
      this.createEvent(
        input,
      );

    return this.publishEvent(
      event,
    );
  }

  /**
   * Publish an already-built canonical event.
   */
  async publishEvent(
    event,
    options = {},
  ) {
    const normalized =
      this.normalizeEvent(
        event,
      );

    const effectiveOptions =
      {
        ...this.options,
        ...options,
      };

    const duplicate =
      effectiveOptions
        .deduplicateEvents
        ? await this._findExistingEvent(
            normalized,
          )
        : null;

    if (duplicate) {
      this._metric(
        'payment_events_duplicate_total',
        1,
        {
          eventType:
            normalized.eventType,
        },
      );

      return {
        success:
          true,

        status:
          EVENT_PUBLISH_STATUS
            .DUPLICATE,

        duplicate:
          true,

        eventId:
          duplicate.eventId ||
          normalized.eventId,

        eventType:
          normalized.eventType,

        aggregateId:
          normalized.aggregateId,

        aggregateVersion:
          normalized.aggregateVersion,
      };
    }

    let persisted =
      false;

    if (
      effectiveOptions.useTransactionalOutbox
    ) {
      try {
        const outboxResult =
          await this._persistOutbox(
            normalized,
            effectiveOptions,
          );

        if (outboxResult) {
          persisted =
            true;

          this._metric(
            'payment_events_outbox_stored_total',
            1,
            {
              eventType:
                normalized.eventType,
            },
          );

          /**
           * In the normal production path the outbox worker owns broker
           * publication. Do not publish twice.
           */
          if (
            !effectiveOptions
              .publishImmediately
          ) {
            await this._recordAudit(
              'PAYMENT_EVENT_STORED',
              normalized,
            );

            return {
              success:
                true,

              status:
                EVENT_PUBLISH_STATUS
                  .STORED,

              stored:
                true,

              eventId:
                normalized.eventId,

              eventType:
                normalized.eventType,

              aggregateId:
                normalized.aggregateId,

              aggregateVersion:
                normalized.aggregateVersion,
            };
          }
        }
      } catch (error) {
        this._logError(
          'Failed to persist payment event to outbox.',
          error,
          {
            eventId:
              normalized.eventId,

            eventType:
              normalized.eventType,

            paymentId:
              normalized.aggregateId,

            tenantId:
              normalized.tenantId,
          },
        );

        if (
          !effectiveOptions
            .allowDirectPublisherFallback
          && effectiveOptions.failOnPublicationError
        ) {
          throw this._wrapPublicationError(
            error,
            normalized,
            PAYMENT_EVENT_ERROR_CODES
              .STORAGE_FAILED,
          );
        }
      }
    }

    /**
     * Direct publication is optional and explicitly configured.
     */
    if (
      effectiveOptions
        .allowDirectPublisherFallback
      || effectiveOptions
        .publishImmediately
    ) {
      const published =
        await this._publishDirect(
          normalized,
          effectiveOptions,
        );

      await this._recordAudit(
        published.status ===
          EVENT_PUBLISH_STATUS.PUBLISHED
          ? 'PAYMENT_EVENT_PUBLISHED'
          : 'PAYMENT_EVENT_FAILED',
        normalized,
      );

      return {
        ...published,

        stored:
          persisted,
      };
    }

    if (
      persisted
    ) {
      return {
        success:
          true,

        status:
          EVENT_PUBLISH_STATUS
            .STORED,

        stored:
          true,

        eventId:
          normalized.eventId,

        eventType:
          normalized.eventType,

        aggregateId:
          normalized.aggregateId,

        aggregateVersion:
          normalized.aggregateVersion,
      };
    }

    throw new PaymentEventPublisherError(
      'No payment event publication mechanism is available.',
      {
        code:
          PAYMENT_EVENT_ERROR_CODES
            .PUBLISHER_UNAVAILABLE,

        statusCode:
          503,

        paymentId:
          normalized.aggregateId,

        tenantId:
          normalized.tenantId,

        eventId:
          normalized.eventId,

        eventType:
          normalized.eventType,
      },
    );
  }

  /* ==========================================================================
   * Convenience Lifecycle Methods
   * ======================================================================== */

  async publishInitiated(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'INITIATED',
      context,
    );
  }

  async publishPending(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'PENDING',
      context,
    );
  }

  async publishProcessing(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'PROCESSING',
      context,
    );
  }

  async publishSuccessful(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'SUCCESSFUL',
      context,
    );
  }

  async publishFailed(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'FAILED',
      context,
    );
  }

  async publishCancelled(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'CANCELLED',
      context,
    );
  }

  async publishReversed(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'REVERSED',
      context,
    );
  }

  async publishRetrying(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'RETRYING',
      context,
    );
  }

  async publishUnknown(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'UNKNOWN',
      context,
    );
  }

  async publishRequiresReconciliation(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'REQUIRES_RECONCILIATION',
      context,
    );
  }

  async publishExpired(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'EXPIRED',
      context,
    );
  }

  async publishDeadLettered(
    payment,
    context = {},
  ) {
    return this.publishPaymentStateEvent(
      payment,
      'DEAD_LETTER',
      context,
    );
  }

  /**
   * Publishes the payment lifecycle transition after the state machine has
   * authoritatively committed it.
   */
  async publishPaymentStateEvent(
    payment,
    state,
    context = {},
  ) {
    const currentState =
      normalizeStatus(
        payment?.status ||
        state,
      );

    const eventType =
      eventTypeForPaymentState(
        currentState,
      );

    return this.publish({
      eventType,

      category:
        PAYMENT_EVENT_CATEGORIES
          .LIFECYCLE,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .PAYMENT_STATE_MACHINE,

      payment,

      context,

      payload: {
        previousState:
          normalizeStatus(
            context.previousState,
          ),

        currentState,

        reasonCode:
          normalizeString(
            context.reasonCode,
          ),

        reason:
          normalizeString(
            context.reason,
          ),

        reversalPaymentId:
          normalizeString(
            context.reversalPaymentId,
          ),

        financialTransactionId:
          normalizeString(
            context.financialTransactionId,
          ),
      },
    });
  }

  /* ==========================================================================
   * Provider Events
   * ======================================================================== */

  async publishProviderCallbackReceived(
    payment,
    providerEvidence,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .PROVIDER_CALLBACK_RECEIVED,

      category:
        PAYMENT_EVENT_CATEGORIES
          .PROVIDER,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .CALLBACK_PROCESSOR,

      payment,

      context,

      payload: {
        provider:
          normalizeProvider(
            providerEvidence?.provider ||
            payment?.provider,
          ),

        providerTransactionId:
          normalizeString(
            providerEvidence
              ?.providerTransactionId,
          ),

        providerEventId:
          normalizeString(
            providerEvidence
              ?.providerEventId,
          ),

        providerStatus:
          normalizeStatus(
            providerEvidence
              ?.status ||
            providerEvidence
              ?.providerStatus,
          ),

        outcome:
          normalizeStatus(
            providerEvidence
              ?.outcome,
          ),

        amount:
          canonicalAmount(
            providerEvidence?.amount,
          ),

        currency:
          canonicalCurrency(
            providerEvidence?.currency,
          ),

        evidenceHash:
          normalizeString(
            providerEvidence?.evidenceHash,
          ),

        signatureVerified:
          providerEvidence
            ?.signatureVerified
          === true,

        timestampVerified:
          providerEvidence
            ?.timestampVerified
          === true,
      },
    });
  }

  async publishProviderStatusVerified(
    payment,
    verification,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .PROVIDER_STATUS_VERIFIED,

      category:
        PAYMENT_EVENT_CATEGORIES
          .PROVIDER,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .PAYMENT_VERIFICATION_SERVICE,

      payment,

      context,

      payload: {
        provider:
          normalizeProvider(
            verification?.provider ||
            payment?.provider,
          ),

        providerTransactionId:
          normalizeString(
            verification
              ?.providerTransactionId ||
            payment?.providerTransactionId,
          ),

        verificationStatus:
          normalizeStatus(
            verification?.status,
          ),

        verified:
          verification?.verified === true,

        reconciliationRequired:
          verification
            ?.reconciliationRequired
          === true,

        evidenceHash:
          normalizeString(
            verification?.evidenceHash,
          ),

        failedChecks:
          Array.isArray(
            verification?.failedChecks,
          )
            ? verification.failedChecks.map(
                (check) => ({
                  name:
                    normalizeString(
                      check?.name,
                    ),

                  code:
                    normalizeString(
                      check?.code,
                    ),
                }),
              )
            : [],
      },
    });
  }

  /* ==========================================================================
   * Financial Events
   * ======================================================================== */

  async publishFinancialPostingStarted(
    payment,
    financial,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .FINANCIAL_POSTING_STARTED,

      category:
        PAYMENT_EVENT_CATEGORIES
          .FINANCIAL,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .FINANCIAL_POSTING,

      payment,

      context,

      payload: {
        financialTransactionId:
          normalizeString(
            financial?.financialTransactionId,
          ),

        amount:
          canonicalAmount(
            financial?.amount ||
            payment?.amount,
          ),

        currency:
          canonicalCurrency(
            financial?.currency ||
            payment?.currency,
          ),

        transactionType:
          normalizeString(
            financial?.transactionType,
          ),

        direction:
          normalizeString(
            financial?.direction ||
            payment?.direction,
          ),

        idempotencyKey:
          normalizeString(
            context.idempotencyKey,
          ),
      },
    });
  }

  async publishFinancialPosted(
    payment,
    financial,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .FINANCIAL_POSTED,

      category:
        PAYMENT_EVENT_CATEGORIES
          .FINANCIAL,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .FINANCIAL_POSTING,

      payment,

      context,

      payload: {
        financialTransactionId:
          normalizeString(
            financial?.financialTransactionId,
          ),

        journalId:
          normalizeString(
            financial?.journalId,
          ),

        amount:
          canonicalAmount(
            financial?.amount ||
            payment?.amount,
          ),

        currency:
          canonicalCurrency(
            financial?.currency ||
            payment?.currency,
          ),

        posted:
          financial?.posted === true,

        status:
          normalizeStatus(
            financial?.status,
          ),

        ledgerAuthority:
          'FINANCE_POSTING_ENGINE',
      },
    });
  }

  async publishFinancialPostingFailed(
    payment,
    financialError,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .FINANCIAL_POSTING_FAILED,

      category:
        PAYMENT_EVENT_CATEGORIES
          .FINANCIAL,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .FINANCIAL_POSTING,

      payment,

      context,

      payload: {
        financialTransactionId:
          normalizeString(
            financialError
              ?.financialTransactionId,
          ),

        errorCode:
          normalizeString(
            financialError?.code,
          ),

        retryable:
          financialError?.retryable
          === true,

        reconciliationRequired:
          financialError
            ?.reconciliationRequired
          === true,
      },
    });
  }

  async publishFinancialPostingUnknown(
    payment,
    financial,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .FINANCIAL_POSTING_UNKNOWN,

      category:
        PAYMENT_EVENT_CATEGORIES
          .FINANCIAL,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .FINANCIAL_POSTING,

      payment,

      context,

      payload: {
        financialTransactionId:
          normalizeString(
            financial?.financialTransactionId,
          ),

        status:
          'UNKNOWN',

        requiresReconciliation:
          true,
      },
    });
  }

  /* ==========================================================================
   * Settlement Events
   * ======================================================================== */

  async publishSettlementInitiated(
    payment,
    settlement,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .SETTLEMENT_INITIATED,

      category:
        PAYMENT_EVENT_CATEGORIES
          .SETTLEMENT,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .SETTLEMENT,

      payment,

      context,

      payload: {
        settlementId:
          safeId(
            settlement?.settlementId ||
            settlement?.id,
          ),

        provider:
          normalizeProvider(
            settlement?.provider ||
            payment?.provider,
          ),

        providerTransactionId:
          normalizeString(
            settlement
              ?.providerTransactionId ||
            payment?.providerTransactionId,
          ),

        amount:
          canonicalAmount(
            settlement?.amount ||
            payment?.amount,
          ),

        currency:
          canonicalCurrency(
            settlement?.currency ||
            payment?.currency,
          ),

        status:
          normalizeStatus(
            settlement?.status ||
            'INITIATED',
          ),
      },
    });
  }

  async publishSettlementCompleted(
    payment,
    settlement,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .SETTLEMENT_COMPLETED,

      category:
        PAYMENT_EVENT_CATEGORIES
          .SETTLEMENT,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .SETTLEMENT,

      payment,

      context,

      payload: {
        settlementId:
          safeId(
            settlement?.settlementId ||
            settlement?.id,
          ),

        settledAmount:
          canonicalAmount(
            settlement?.settledAmount ||
            payment?.amount,
          ),

        currency:
          canonicalCurrency(
            settlement?.currency ||
            payment?.currency,
          ),

        status:
          'COMPLETED',

        reconciliationRequired:
          false,
      },
    });
  }

  async publishSettlementFailed(
    payment,
    settlement,
    context = {},
  ) {
    return this.publish({
      eventType:
        PAYMENT_EVENT_TYPES
          .SETTLEMENT_FAILED,

      category:
        PAYMENT_EVENT_CATEGORIES
          .SETTLEMENT,

      source:
        context.source ||
        PAYMENT_EVENT_SOURCES
          .SETTLEMENT,

      payment,

      context,

      payload: {
        settlementId:
          safeId(
            settlement?.settlementId ||
            settlement?.id,
          ),

        status:
          'FAILED',

        errorCode:
          normalizeString(
            settlement?.errorCode ||
            settlement?.code,
          ),

        reconciliationRequired:
          true,
      },
    });
  }

  /* ==========================================================================
   * Event Construction
   * ======================================================================== */

  createEvent(
    input = {},
  ) {
    const payment =
      this._normalizePayment(
        input.payment ||
        input.aggregate ||
        input,
      );

    const context =
      this._normalizeContext(
        input.context ||
        input,
      );

    const eventType =
      normalizeString(
        input.eventType,
      );

    if (!eventType) {
      throw new PaymentEventPublisherError(
        'Payment event type is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .EVENT_TYPE_REQUIRED,

          statusCode:
            400,

          paymentId:
            payment.id,

          tenantId:
            payment.tenantId,
        },
      );
    }

    const eventId =
      normalizeString(
        input.eventId,
      ) ||
      createEventId(
        this.options.eventIdPrefix,
      );

    const occurredAt =
      input.occurredAt ||
      isoNow();

    const eventVersion =
      parseVersion(
        input.eventVersion,
      ) ||
      PAYMENT_EVENT_SCHEMA_VERSION;

    const aggregateVersion =
      parseVersion(
        input.aggregateVersion,
      ) ??
      parseVersion(
        payment.version,
      ) ??
      0;

    const payload =
      this._buildPaymentPayload(
        payment,
        input.payload ||
        input.data ||
        {},
        context,
      );

    const event = {
      eventId,

      eventType,

      eventVersion,

      eventSchema:
        this._schemaName(
          eventType,
          eventVersion,
        ),

      category:
        normalizeString(
          input.category,
        ) ||
        categoryForEventType(
          eventType,
        ),

      occurredAt,

      publishedAt:
        null,

      source:
        normalizeString(
          input.source,
        ) ||
        this.options.eventSource,

      environment:
        this.options.environment,

      producer:
        normalizeString(
          input.producer,
        ) ||
        this.options.eventSource,

      tenantId:
        payment.tenantId ||
        context.tenantId,

      aggregateType:
        'Payment',

      aggregateId:
        payment.id,

      aggregateVersion,

      correlationId:
        context.correlationId ||
        createCorrelationId(),

      causationId:
        context.causationId ||
        null,

      requestId:
        context.requestId ||
        null,

      operationId:
        context.operationId ||
        null,

      idempotencyKey:
        context.idempotencyKey ||
        null,

      sequence:
        aggregateVersion,

      data:
        payload,

      metadata:
        this._buildMetadata(
          payment,
          context,
          input.metadata ||
          {},
        ),
    };

    event.eventFingerprint =
      this._calculateEventFingerprint(
        event,
      );

    return this.normalizeEvent(
      event,
    );
  }

  normalizeEvent(
    event,
  ) {
    if (
      !event ||
      typeof event !== 'object'
    ) {
      throw new PaymentEventPublisherError(
        'A payment event object is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .INVALID_EVENT,

          statusCode:
            400,
        },
      );
    }

    const normalized = {
      ...clone(event),

      eventId:
        normalizeString(
          event.eventId,
        ),

      eventType:
        normalizeString(
          event.eventType,
        ),

      eventVersion:
        parseVersion(
          event.eventVersion,
        ),

      category:
        normalizeString(
          event.category,
        ),

      occurredAt:
        event.occurredAt ||
        isoNow(),

      source:
        normalizeString(
          event.source,
        ),

      environment:
        normalizeString(
          event.environment,
        ) ||
        this.options.environment,

      producer:
        normalizeString(
          event.producer,
        ) ||
        this.options.eventSource,

      tenantId:
        normalizeString(
          event.tenantId,
        ),

      aggregateType:
        normalizeString(
          event.aggregateType,
        ),

      aggregateId:
        safeId(
          event.aggregateId,
        ),

      aggregateVersion:
        parseVersion(
          event.aggregateVersion,
        ),

      correlationId:
        normalizeString(
          event.correlationId,
        ),

      causationId:
        normalizeString(
          event.causationId,
        ),

      requestId:
        normalizeString(
          event.requestId,
        ),

      operationId:
        normalizeString(
          event.operationId,
        ),

      idempotencyKey:
        normalizeString(
          event.idempotencyKey,
        ),

      sequence:
        parseVersion(
          event.sequence,
        ),

      data:
        this._sanitizePayload(
          event.data ||
          {},
        ),

      metadata:
        this._sanitizeMetadata(
          event.metadata ||
          {},
        ),
    };

    if (!normalized.eventId) {
      throw new PaymentEventPublisherError(
        'Payment event ID is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .VERSION_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    if (!normalized.eventType) {
      throw new PaymentEventPublisherError(
        'Payment event type is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .EVENT_TYPE_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    if (!normalized.eventVersion) {
      throw new PaymentEventPublisherError(
        'Payment event schema version is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .VERSION_REQUIRED,

          statusCode:
            400,

          eventId:
            normalized.eventId,

          eventType:
            normalized.eventType,
        },
      );
    }

    if (
      this.options.requireTenant &&
      !normalized.tenantId
    ) {
      throw new PaymentEventPublisherError(
        'Payment event tenant ID is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .TENANT_ID_REQUIRED,

          statusCode:
            403,

          eventId:
            normalized.eventId,

          eventType:
            normalized.eventType,
        },
      );
    }

    if (!normalized.aggregateId) {
      throw new PaymentEventPublisherError(
        'Payment event aggregate ID is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .PAYMENT_ID_REQUIRED,

          statusCode:
            400,

          eventId:
            normalized.eventId,

          eventType:
            normalized.eventType,
        },
      );
    }

    if (
      !normalized.aggregateType
    ) {
      normalized.aggregateType =
        'Payment';
    }

    if (
      normalized.aggregateVersion ===
      null
    ) {
      normalized.aggregateVersion =
        0;
    }

    if (
      this.options.requireCorrelationId &&
      !normalized.correlationId
    ) {
      throw new PaymentEventPublisherError(
        'Payment event correlation ID is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .CORRELATION_REQUIRED,

          statusCode:
            400,

          eventId:
            normalized.eventId,

          eventType:
            normalized.eventType,
        },
      );
    }

    if (
      this.options.requireCausationId &&
      !normalized.causationId
    ) {
      throw new PaymentEventPublisherError(
        'Payment event causation ID is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .CORRELATION_REQUIRED,

          statusCode:
            400,

          eventId:
            normalized.eventId,

          eventType:
            normalized.eventType,
        },
      );
    }

    if (
      this.options.requireRequestId &&
      !normalized.requestId
    ) {
      throw new PaymentEventPublisherError(
        'Payment event request ID is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .CORRELATION_REQUIRED,

          statusCode:
            400,

          eventId:
            normalized.eventId,

          eventType:
            normalized.eventType,
        },
      );
    }

    normalized.eventSchema =
      normalized.eventSchema ||
      this._schemaName(
        normalized.eventType,
        normalized.eventVersion,
      );

    normalized.eventFingerprint =
      normalized.eventFingerprint ||
      this._calculateEventFingerprint(
        normalized,
      );

    return Object.freeze(
      normalized,
    );
  }

  _normalizePayment(
    payment,
  ) {
    if (
      !payment ||
      typeof payment !== 'object'
    ) {
      throw new PaymentEventPublisherError(
        'Payment aggregate is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .INVALID_EVENT,

          statusCode:
            400,
        },
      );
    }

    const plain =
      typeof payment.toObject ===
        'function'
        ? payment.toObject()
        : payment;

    const paymentId =
      safeId(
        plain.id ||
        plain._id,
      );

    if (!paymentId) {
      throw new PaymentEventPublisherError(
        'Payment ID is required.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .PAYMENT_ID_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    return {
      ...clone(plain),

      id:
        paymentId,

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      userId:
        safeId(
          plain.userId,
        ),

      groupId:
        safeId(
          plain.groupId,
        ),

      loanId:
        safeId(
          plain.loanId,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference ||
          plain.reference,
        ),

      type:
        normalizeString(
          plain.type ||
          plain.paymentType,
        )?.toLowerCase(),

      direction:
        normalizeString(
          plain.direction,
        )?.toLowerCase(),

      amount:
        canonicalAmount(
          plain.amount,
        ),

      currency:
        canonicalCurrency(
          plain.currency,
        ),

      provider:
        normalizeProvider(
          plain.provider,
        ),

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId,
        ),

      providerEventId:
        normalizeString(
          plain.providerEventId,
        ),

      status:
        normalizeStatus(
          plain.status ||
          plain.state,
        ),

      financialTransactionId:
        safeId(
          plain.financialTransactionId,
        ),

      version:
        parseVersion(
          plain.version,
        ) ??
        parseVersion(
          plain.__v,
        ) ??
        0,
    };
  }

  _normalizeContext(
    context,
  ) {
    return {
      tenantId:
        normalizeString(
          context?.tenantId,
        ),

      actorId:
        normalizeString(
          context?.actorId,
        ),

      actorType:
        normalizeString(
          context?.actorType,
        ),

      actorRole:
        normalizeString(
          context?.actorRole,
        ),

      requestId:
        normalizeString(
          context?.requestId,
        ),

      correlationId:
        normalizeString(
          context?.correlationId,
        ),

      causationId:
        normalizeString(
          context?.causationId,
        ),

      operationId:
        normalizeString(
          context?.operationId,
        ),

      idempotencyKey:
        normalizeString(
          context?.idempotencyKey,
        ),

      previousState:
        normalizeStatus(
          context?.previousState,
        ),

      reason:
        normalizeString(
          context?.reason,
        ),

      reasonCode:
        normalizeString(
          context?.reasonCode,
        ),

      providerEventId:
        normalizeString(
          context?.providerEventId,
        ),

      providerTransactionId:
        normalizeString(
          context?.providerTransactionId,
        ),

      source:
        normalizeString(
          context?.source,
        ),

      metadata:
        this._sanitizeMetadata(
          context?.metadata ||
          {},
        ),
    };
  }

  /* ==========================================================================
   * Payload Construction
   * ======================================================================== */

  _buildPaymentPayload(
    payment,
    inputPayload,
    context,
  ) {
    return {
      paymentId:
        payment.id,

      paymentReference:
        payment.paymentReference ||
        null,

      tenantId:
        payment.tenantId ||
        context.tenantId ||
        null,

      userId:
        payment.userId ||
        null,

      groupId:
        payment.groupId ||
        null,

      loanId:
        payment.loanId ||
        null,

      type:
        payment.type ||
        null,

      direction:
        payment.direction ||
        null,

      amount:
        canonicalAmount(
          payment.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency,
        ),

      provider:
        normalizeProvider(
          payment.provider ||
          inputPayload.provider ||
          context.provider,
        ),

      providerTransactionId:
        normalizeString(
          payment.providerTransactionId ||
          inputPayload.providerTransactionId ||
          context.providerTransactionId,
        ),

      providerEventId:
        normalizeString(
          payment.providerEventId ||
          inputPayload.providerEventId ||
          context.providerEventId,
        ),

      status:
        normalizeStatus(
          payment.status ||
          inputPayload.status,
        ),

      financialTransactionId:
        safeId(
          payment.financialTransactionId ||
          inputPayload.financialTransactionId,
        ),

      ...this._sanitizePayload(
        inputPayload,
      ),
    };
  }

  _buildMetadata(
    payment,
    context,
    metadata,
  ) {
    return {
      paymentId:
        payment.id,

      tenantId:
        payment.tenantId ||
        context.tenantId ||
        null,

      provider:
        normalizeProvider(
          payment.provider ||
          context.provider,
        ),

      requestId:
        context.requestId ||
        null,

      correlationId:
        context.correlationId ||
        null,

      causationId:
        context.causationId ||
        null,

      operationId:
        context.operationId ||
        null,

      idempotencyKey:
        context.idempotencyKey ||
        null,

      actorType:
        context.actorType ||
        null,

      reasonCode:
        context.reasonCode ||
        null,

      ...this._sanitizeMetadata(
        metadata,
      ),
    };
  }

  _schemaName(
    eventType,
    eventVersion,
  ) {
    const normalizedName =
      String(
        eventType ||
        'PaymentEvent',
      )
        .replace(
          /[^A-Za-z0-9]+/g,
          '',
        );

    return `titech.payment.${normalizedName.toLowerCase()}.v${eventVersion}`;
  }

  /* ==========================================================================
   * Outbox
   * ======================================================================== */

  async _persistOutbox(
    event,
    options,
  ) {
    if (
      !this.outboxRepository
    ) {
      if (
        options.strictMode
      ) {
        throw new PaymentEventPublisherError(
          'Transactional outbox repository is required in strict mode.',
          {
            code:
              PAYMENT_EVENT_ERROR_CODES
                .OUTBOX_UNAVAILABLE,

            statusCode:
              503,

            paymentId:
              event.aggregateId,

            tenantId:
              event.tenantId,

            eventId:
              event.eventId,

            eventType:
              event.eventType,
          },
        );
      }

      return null;
    }

    const record =
      this._toOutboxRecord(
        event,
      );

    try {
      if (
        typeof this.outboxRepository
          .createIfNotExists === 'function'
      ) {
        return this.outboxRepository
          .createIfNotExists(
            record,
          );
      }

      if (
        typeof this.outboxRepository
          .insertIfAbsent === 'function'
      ) {
        return this.outboxRepository
          .insertIfAbsent(
            record,
          );
      }

      if (
        typeof this.outboxRepository
          .create === 'function'
      ) {
        return this.outboxRepository
          .create(
            record,
          );
      }

      if (
        typeof this.outboxRepository
          .insert === 'function'
      ) {
        return this.outboxRepository
          .insert(
            record,
          );
      }

      throw new PaymentEventPublisherError(
        'Configured outbox repository does not implement a supported persistence method.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .OUTBOX_UNAVAILABLE,

          statusCode:
            500,

          paymentId:
            event.aggregateId,

          tenantId:
            event.tenantId,

          eventId:
            event.eventId,
        },
      );
    } catch (error) {
      if (
        this._isDuplicateStorageError(
          error,
        )
      ) {
        return {
          duplicate:
            true,

          eventId:
            event.eventId,

          eventFingerprint:
            event.eventFingerprint,
        };
      }

      throw error;
    }
  }

  _toOutboxRecord(
    event,
  ) {
    return {
      eventId:
        event.eventId,

      eventType:
        event.eventType,

      eventVersion:
        event.eventVersion,

      eventSchema:
        event.eventSchema,

      category:
        event.category,

      aggregateType:
        event.aggregateType,

      aggregateId:
        event.aggregateId,

      aggregateVersion:
        event.aggregateVersion,

      tenantId:
        event.tenantId,

      correlationId:
        event.correlationId,

      causationId:
        event.causationId,

      requestId:
        event.requestId,

      operationId:
        event.operationId,

      idempotencyKey:
        event.idempotencyKey,

      eventFingerprint:
        event.eventFingerprint,

      payload:
        clone(
          event.data,
        ),

      metadata:
        clone(
          event.metadata,
        ),

      source:
        event.source,

      producer:
        event.producer,

      environment:
        event.environment,

      occurredAt:
        event.occurredAt,

      status:
        'PENDING',

      attempts:
        0,

      nextAttemptAt:
        now(),

      createdAt:
        now(),

      updatedAt:
        now(),
    };
  }

  /* ==========================================================================
   * Direct Publisher
   * ======================================================================== */

  async _publishDirect(
    event,
    options,
  ) {
    const publisher =
      this._resolveDirectPublisher();

    if (!publisher) {
      throw new PaymentEventPublisherError(
        'Direct payment event publisher is unavailable.',
        {
          code:
            PAYMENT_EVENT_ERROR_CODES
              .PUBLISHER_UNAVAILABLE,

          statusCode:
            503,

          paymentId:
            event.aggregateId,

          tenantId:
            event.tenantId,

          eventId:
            event.eventId,

          eventType:
            event.eventType,
        },
      );
    }

    try {
      let result;

      if (
        typeof publisher.publish
          === 'function'
      ) {
        result =
          await publisher.publish(
            event,
          );
      } else if (
        typeof publisher.publishEvent
          === 'function'
      ) {
        result =
          await publisher.publishEvent(
            event,
          );
      } else if (
        typeof publisher.emit
          === 'function'
      ) {
        result =
          await publisher.emit(
            event.eventType,
            event,
          );
      } else {
        throw new PaymentEventPublisherError(
          'Configured event publisher does not implement a supported publication method.',
          {
            code:
              PAYMENT_EVENT_ERROR_CODES
                .PUBLISHER_UNAVAILABLE,

            statusCode:
              500,

            paymentId:
              event.aggregateId,

            tenantId:
              event.tenantId,

            eventId:
              event.eventId,
          },
        );
      }

      this._metric(
        'payment_events_published_total',
        1,
        {
          eventType:
            event.eventType,
        },
      );

      return {
        success:
          true,

        status:
          EVENT_PUBLISH_STATUS
            .PUBLISHED,

        published:
          true,

        eventId:
          event.eventId,

        eventType:
          event.eventType,

        aggregateId:
          event.aggregateId,

        aggregateVersion:
          event.aggregateVersion,

        providerResult:
          this._sanitizePublisherResult(
            result,
          ),
      };
    } catch (error) {
      this._metric(
        'payment_events_publish_failed_total',
        1,
        {
          eventType:
            event.eventType,
        },
      );

      if (
        this._isDuplicateStorageError(
          error,
        )
      ) {
        return {
          success:
            true,

          status:
            EVENT_PUBLISH_STATUS
              .DUPLICATE,

          duplicate:
            true,

          eventId:
            event.eventId,

          eventType:
            event.eventType,
        };
      }

      if (
        !options.failOnPublicationError
      ) {
        return {
          success:
            false,

          status:
            EVENT_PUBLISH_STATUS
              .FAILED,

          published:
            false,

          eventId:
            event.eventId,

          eventType:
            event.eventType,

          errorCode:
            normalizeString(
              error?.code,
            ),
        };
      }

      throw this._wrapPublicationError(
        error,
        event,
        PAYMENT_EVENT_ERROR_CODES
          .PUBLISH_FAILED,
      );
    }
  }

  _resolveDirectPublisher() {
    return (
      this.transactionEventPublisher ||
      this.eventPublisher ||
      null
    );
  }

  /* ==========================================================================
   * Deduplication
   * ======================================================================== */

  async _findExistingEvent(
    event,
  ) {
    if (
      !this.outboxRepository
    ) {
      return null;
    }

    if (
      typeof this.outboxRepository
        .findByEventId === 'function'
    ) {
      const byId =
        await this.outboxRepository
          .findByEventId(
            event.eventId,
          );

      if (byId) {
        return byId;
      }
    }

    if (
      typeof this.outboxRepository
        .findByFingerprint === 'function'
    ) {
      const byFingerprint =
        await this.outboxRepository
          .findByFingerprint({
            tenantId:
              event.tenantId,

            eventFingerprint:
              event.eventFingerprint,
          });

      if (byFingerprint) {
        return byFingerprint;
      }
    }

    if (
      typeof this.outboxRepository
        .findByAggregateVersion === 'function'
    ) {
      return this.outboxRepository
        .findByAggregateVersion({
          tenantId:
            event.tenantId,

          aggregateType:
            event.aggregateType,

          aggregateId:
            event.aggregateId,

          aggregateVersion:
            event.aggregateVersion,

          eventType:
            event.eventType,
        });
    }

    return null;
  }

  _isDuplicateStorageError(
    error,
  ) {
    if (!error) {
      return false;
    }

    if (
      error.code ===
      PAYMENT_EVENT_ERROR_CODES
        .DUPLICATE_EVENT
    ) {
      return true;
    }

    const code =
      String(
        error.code ||
        '',
      ).toUpperCase();

    const message =
      String(
        error.message ||
        '',
      ).toLowerCase();

    return (
      [
        'E11000',
        'DUPLICATE_KEY',
        'DUPLICATE_EVENT',
        'UNIQUE_CONSTRAINT',
      ].includes(code)
      ||
      message.includes(
        'duplicate key',
      )
      ||
      message.includes(
        'already exists',
      )
    );
  }

  /* ==========================================================================
   * Fingerprint
   * ======================================================================== */

  _calculateEventFingerprint(
    event,
  ) {
    return sha256({
      eventType:
        event.eventType,

      eventVersion:
        event.eventVersion,

      tenantId:
        event.tenantId,

      aggregateType:
        event.aggregateType,

      aggregateId:
        event.aggregateId,

      aggregateVersion:
        event.aggregateVersion,

      correlationId:
        event.correlationId,

      data:
        this._sanitizePayload(
          event.data || {},
        ),
    });
  }

  /* ==========================================================================
   * Sanitization
   * ======================================================================== */

  _sanitizePayload(
    payload,
    depth = 0,
  ) {
    if (
      depth >
      this.options.maxMetadataDepth
    ) {
      return '[MAX_DEPTH]';
    }

    if (
      payload === null ||
      payload === undefined
    ) {
      return payload;
    }

    if (
      typeof payload === 'string'
    ) {
      return payload.length >
        this.options
          .maxMetadataStringLength
        ? `${payload.slice(
            0,
            this.options
              .maxMetadataStringLength,
          )}...`
        : payload;
    }

    if (
      typeof payload === 'number' ||
      typeof payload === 'boolean'
    ) {
      return payload;
    }

    if (
      payload instanceof Date
    ) {
      return payload.toISOString();
    }

    if (
      Array.isArray(payload)
    ) {
      return payload
        .slice(
          0,
          this.options.maxMetadataKeys,
        )
        .map(
          (item) =>
            this._sanitizePayload(
              item,
              depth + 1,
            ),
        );
    }

    if (
      typeof payload !== 'object'
    ) {
      return String(payload);
    }

    const sensitiveKeys =
      new Set([
        'password',
        'token',
        'accessToken',
        'refreshToken',
        'secret',
        'clientSecret',
        'apiKey',
        'privateKey',
        'authorization',
        'rawAuthorizationHeader',
        'signature',
        'signatureSecret',
        'webhookSecret',
        'rawBody',
        'encryptedSecret',
      ]);

    const output = {};
    const entries =
      Object.entries(
        payload,
      ).slice(
        0,
        this.options.maxMetadataKeys,
      );

    for (
      const [
        key,
        value,
      ] of entries
    ) {
      if (
        sensitiveKeys.has(
          key,
        )
      ) {
        output[key] =
          '[REDACTED]';

        continue;
      }

      /**
       * Explicit protection against raw provider callback payloads.
       */
      if (
        !this.options
          .includeRawProviderPayload
        &&
        [
          'rawProviderResponse',
          'rawCallback',
          'rawPayload',
          'rawBody',
          'providerRaw',
        ].includes(key)
      ) {
        continue;
      }

      output[key] =
        this._sanitizePayload(
          value,
          depth + 1,
        );
    }

    return output;
  }

  _sanitizeMetadata(
    metadata,
  ) {
    return this._sanitizePayload(
      metadata || {},
      0,
    );
  }

  _sanitizePublisherResult(
    result,
  ) {
    if (
      result === undefined ||
      result === null
    ) {
      return null;
    }

    if (
      typeof result === 'string'
      || typeof result === 'number'
      || typeof result === 'boolean'
    ) {
      return result;
    }

    return this._sanitizeMetadata(
      result,
    );
  }

  /* ==========================================================================
   * Audit
   * ======================================================================== */

  async _recordAudit(
    action,
    event,
  ) {
    if (
      !this.auditService
    ) {
      return null;
    }

    const payload = {
      action,

      tenantId:
        event.tenantId,

      resourceType:
        'Payment',

      resourceId:
        event.aggregateId,

      paymentId:
        event.aggregateId,

      eventId:
        event.eventId,

      eventType:
        event.eventType,

      aggregateVersion:
        event.aggregateVersion,

      category:
        event.category,

      source:
        event.source,

      correlationId:
        event.correlationId,

      causationId:
        event.causationId,

      requestId:
        event.requestId,

      operationId:
        event.operationId,

      createdAt:
        isoNow(),
    };

    try {
      if (
        typeof this.auditService
          .record === 'function'
      ) {
        return this.auditService.record(
          payload,
        );
      }

      if (
        typeof this.auditService
          .create === 'function'
      ) {
        return this.auditService.create(
          payload,
        );
      }
    } catch (error) {
      this._logError(
        'Failed to record payment event audit entry.',
        error,
        {
          eventId:
            event.eventId,

          eventType:
            event.eventType,

          paymentId:
            event.aggregateId,
        },
      );

      if (
        this.options.strictMode
      ) {
        throw error;
      }
    }

    return null;
  }

  /* ==========================================================================
   * Metrics
   * ======================================================================== */

  _metric(
    name,
    value,
    labels = {},
  ) {
    try {
      if (
        !this.metrics
      ) {
        return;
      }

      if (
        typeof this.metrics.increment
          === 'function'
      ) {
        this.metrics.increment(
          name,
          value,
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.inc
          === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch (_error) {
      /**
       * Metrics are observational and must never break payment processing.
       */
    }
  }

  /* ==========================================================================
   * Errors / Logging
   * ======================================================================== */

  _wrapPublicationError(
    error,
    event,
    code,
  ) {
    if (
      error instanceof
      PaymentEventPublisherError
    ) {
      return error;
    }

    return new PaymentEventPublisherError(
      error?.message ||
      'Payment event publication failed.',
      {
        code,

        statusCode:
          Number(
            error?.statusCode,
          ) || 503,

        paymentId:
          event.aggregateId,

        tenantId:
          event.tenantId,

        eventId:
          event.eventId,

        eventType:
          event.eventType,

        retryable:
          true,

        details:
          this._sanitizeMetadata(
            error?.details,
          ),

        cause:
          error,
      },
    );
  }

  _logError(
    message,
    error,
    metadata = {},
  ) {
    try {
      if (
        this.logger &&
        typeof this.logger.error ===
          'function'
      ) {
        this.logger.error(
          message,
          {
            error: {
              name:
                error?.name,

              code:
                error?.code,

              message:
                error?.message,
            },

            ...this._sanitizeMetadata(
              metadata,
            ),
          },
        );
      }
    } catch (_loggingError) {
      /**
       * Never mask the primary event/persistence error with a logging error.
       */
    }
  }

  /* ==========================================================================
   * Health / Diagnostics
   * ======================================================================== */

  getConfiguration() {
    return Object.freeze({
      strictMode:
        this.options.strictMode,

      requireTenant:
        this.options.requireTenant,

      requireCorrelationId:
        this.options.requireCorrelationId,

      requireCausationId:
        this.options.requireCausationId,

      requireRequestId:
        this.options.requireRequestId,

      useTransactionalOutbox:
        this.options.useTransactionalOutbox,

      publishImmediately:
        this.options.publishImmediately,

      allowDirectPublisherFallback:
        this.options
          .allowDirectPublisherFallback,

      failOnPublicationError:
        this.options.failOnPublicationError,

      deduplicateEvents:
        this.options.deduplicateEvents,

      hasOutboxRepository:
        Boolean(
          this.outboxRepository,
        ),

      hasDirectPublisher:
        Boolean(
          this._resolveDirectPublisher(),
        ),

      hasAuditService:
        Boolean(
          this.auditService,
        ),
    });
  }

  validateConfiguration() {
    const errors = [];

    if (
      this.options.strictMode &&
      this.options.useTransactionalOutbox &&
      !this.outboxRepository
    ) {
      errors.push(
        'Transactional outbox repository is required in strict mode.',
      );
    }

    if (
      this.options.publishImmediately &&
      !this._resolveDirectPublisher()
    ) {
      errors.push(
        'Immediate publication is enabled but no direct event publisher is configured.',
      );
    }

    return {
      valid:
        errors.length === 0,

      errors,
    };
  }

  getEventTypes() {
    return Object.freeze({
      ...PAYMENT_EVENT_TYPES,
    });
  }

  getSchemaVersion() {
    return PAYMENT_EVENT_SCHEMA_VERSION;
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

PaymentEventPublisher.EVENT_TYPES =
  PAYMENT_EVENT_TYPES;

PaymentEventPublisher.EVENT_SCHEMA_VERSION =
  PAYMENT_EVENT_SCHEMA_VERSION;

PaymentEventPublisher.EVENT_SOURCES =
  PAYMENT_EVENT_SOURCES;

PaymentEventPublisher.EVENT_CATEGORIES =
  PAYMENT_EVENT_CATEGORIES;

PaymentEventPublisher.PUBLISH_STATUS =
  EVENT_PUBLISH_STATUS;

PaymentEventPublisher.ERROR_CODES =
  PAYMENT_EVENT_ERROR_CODES;

PaymentEventPublisher.PaymentEventPublisherError =
  PaymentEventPublisherError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createPaymentEventPublisher(
  dependencies = {},
) {
  return new PaymentEventPublisher(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  PaymentEventPublisher;

module.exports.PaymentEventPublisher =
  PaymentEventPublisher;

module.exports.PaymentEventPublisherError =
  PaymentEventPublisherError;

module.exports.createPaymentEventPublisher =
  createPaymentEventPublisher;

module.exports.PAYMENT_EVENT_TYPES =
  PAYMENT_EVENT_TYPES;

module.exports.PAYMENT_EVENT_SCHEMA_VERSION =
  PAYMENT_EVENT_SCHEMA_VERSION;

module.exports.PAYMENT_EVENT_SOURCES =
  PAYMENT_EVENT_SOURCES;

module.exports.PAYMENT_EVENT_CATEGORIES =
  PAYMENT_EVENT_CATEGORIES;

module.exports.EVENT_PUBLISH_STATUS =
  EVENT_PUBLISH_STATUS;

module.exports.PAYMENT_EVENT_ERROR_CODES =
  PAYMENT_EVENT_ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */