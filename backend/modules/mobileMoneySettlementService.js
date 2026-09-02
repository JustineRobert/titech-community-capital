/**
 * ============================================================================
 * MOBILE MONEY SETTLEMENT SERVICE
 * ============================================================================
 *
 * TITech Community Capital LTD
 *
 * File:
 * backend/modules/mobileMoneySettlementService.js
 *
 * ============================================================================
 * ENTERPRISE SETTLEMENT LIFECYCLE
 * ============================================================================
 *
 * RECEIVED
 *    ↓
 * VALIDATED
 *    ↓
 * RECORDED
 *    ↓
 * MATCHED
 *    ↓
 * SETTLED
 *    ↓
 * RECONCILED
 *    ↓
 * CLOSED
 *
 * Exception states:
 *
 * FAILED
 * DISPUTED
 * REVERSED
 *
 * ============================================================================
 * RESPONSIBILITIES
 * ============================================================================
 *
 * • Settlement recording
 * • Settlement state machine
 * • Provider/reference correlation
 * • Tenant isolation
 * • Idempotency protection
 * • Persistent settlement lifecycle
 * • Immutable settlement records
 * • Reconciliation
 * • Variance detection
 * • Variance lifecycle
 * • Settlement reversal
 * • Accounting integration hooks
 * • Loan accounting integration hooks
 * • Audit evidence
 * • Provider callback correlation
 * • Operational metrics
 * • Health/readiness reporting
 * • Event emission
 * • Backward-compatible postSettlement() API
 *
 * ============================================================================
 * FINANCIAL PRINCIPLES
 * ============================================================================
 *
 * 1. This service does NOT directly mutate balances.
 *
 * 2. This service does NOT replace the Ledger Engine.
 *
 * 3. Settlement records are append-only.
 *
 * 4. A reversal creates a new financial event.
 *
 * 5. A settlement is not "reconciled" merely because a provider callback
 *    exists.
 *
 * 6. Provider references and internal references must remain correlated.
 *
 * 7. Duplicate provider callbacks must be idempotent.
 *
 * 8. Tenant identifiers are included in every persistence and idempotency
 *    boundary.
 *
 * 9. Variances have an explicit lifecycle and evidence.
 *
 * 10. Financial posting must ultimately flow through the existing
 *     Loan Accounting / Ledger / Posting Engine.
 *
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SERVICE_NAME =
  'mobileMoneySettlementService';

const DEFAULT_CURRENCY =
  'UGX';

/**
 * --------------------------------------------------------------------------
 * Settlement lifecycle
 * --------------------------------------------------------------------------
 */

const SETTLEMENT_STATUS = Object.freeze({
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  RECORDED: 'RECORDED',
  MATCHED: 'MATCHED',
  SETTLED: 'SETTLED',
  RECONCILED: 'RECONCILED',
  CLOSED: 'CLOSED',

  FAILED: 'FAILED',
  DISPUTED: 'DISPUTED',
  REVERSED: 'REVERSED',
});

const VALID_STATUSES =
  new Set(
    Object.values(
      SETTLEMENT_STATUS
    )
  );

/**
 * --------------------------------------------------------------------------
 * Reconciliation lifecycle
 * --------------------------------------------------------------------------
 */

const RECONCILIATION_STATUS =
  Object.freeze({
    UNRECONCILED: 'UNRECONCILED',
    PENDING: 'PENDING',
    MATCHED: 'MATCHED',
    VARIANCE: 'VARIANCE',
    RESOLVED: 'RESOLVED',
    RECONCILED: 'RECONCILED',
    DISPUTED: 'DISPUTED',
  });

const VALID_RECONCILIATION_STATUSES =
  new Set(
    Object.values(
      RECONCILIATION_STATUS
    )
  );

/**
 * --------------------------------------------------------------------------
 * Variance lifecycle
 * --------------------------------------------------------------------------
 */

const VARIANCE_STATUS =
  Object.freeze({
    NONE: 'NONE',
    DETECTED: 'DETECTED',
    INVESTIGATING: 'INVESTIGATING',
    RESOLVED: 'RESOLVED',
    WAIVED: 'WAIVED',
    DISPUTED: 'DISPUTED',
  });

const VALID_VARIANCE_STATUSES =
  new Set(
    Object.values(
      VARIANCE_STATUS
    )
  );

/**
 * --------------------------------------------------------------------------
 * Settlement event types
 * --------------------------------------------------------------------------
 */

const SETTLEMENT_EVENT =
  Object.freeze({
    RECEIVED:
      'settlement.received',

    VALIDATED:
      'settlement.validated',

    RECORDED:
      'settlement.recorded',

    MATCHED:
      'settlement.matched',

    SETTLED:
      'settlement.settled',

    RECONCILED:
      'settlement.reconciled',

    CLOSED:
      'settlement.closed',

    DISPUTED:
      'settlement.disputed',

    VARIANCE_DETECTED:
      'settlement.variance.detected',

    VARIANCE_RESOLVED:
      'settlement.variance.resolved',

    REVERSED:
      'settlement.reversed',

    FAILED:
      'settlement.failed',
  });

/**
 * --------------------------------------------------------------------------
 * Allowed lifecycle transitions
 * --------------------------------------------------------------------------
 */

const ALLOWED_TRANSITIONS =
  Object.freeze({
    [SETTLEMENT_STATUS.RECEIVED]:
      new Set([
        SETTLEMENT_STATUS.VALIDATED,
        SETTLEMENT_STATUS.FAILED,
      ]),

    [SETTLEMENT_STATUS.VALIDATED]:
      new Set([
        SETTLEMENT_STATUS.RECORDED,
        SETTLEMENT_STATUS.FAILED,
      ]),

    [SETTLEMENT_STATUS.RECORDED]:
      new Set([
        SETTLEMENT_STATUS.MATCHED,
        SETTLEMENT_STATUS.SETTLED,
        SETTLEMENT_STATUS.DISPUTED,
        SETTLEMENT_STATUS.FAILED,
      ]),

    [SETTLEMENT_STATUS.MATCHED]:
      new Set([
        SETTLEMENT_STATUS.SETTLED,
        SETTLEMENT_STATUS.DISPUTED,
        SETTLEMENT_STATUS.FAILED,
      ]),

    [SETTLEMENT_STATUS.SETTLED]:
      new Set([
        SETTLEMENT_STATUS.RECONCILED,
        SETTLEMENT_STATUS.DISPUTED,
        SETTLEMENT_STATUS.REVERSED,
      ]),

    [SETTLEMENT_STATUS.RECONCILED]:
      new Set([
        SETTLEMENT_STATUS.CLOSED,
        SETTLEMENT_STATUS.DISPUTED,
        SETTLEMENT_STATUS.REVERSED,
      ]),

    [SETTLEMENT_STATUS.CLOSED]:
      new Set([
        SETTLEMENT_STATUS.REVERSED,
      ]),

    [SETTLEMENT_STATUS.DISPUTED]:
      new Set([
        SETTLEMENT_STATUS.MATCHED,
        SETTLEMENT_STATUS.SETTLED,
        SETTLEMENT_STATUS.RECONCILED,
        SETTLEMENT_STATUS.REVERSED,
      ]),

    [SETTLEMENT_STATUS.FAILED]:
      new Set([
        SETTLEMENT_STATUS.RECEIVED,
      ]),

    [SETTLEMENT_STATUS.REVERSED]:
      new Set([]),
  });

/**
 * --------------------------------------------------------------------------
 * Default configuration
 * --------------------------------------------------------------------------
 */

const DEFAULT_CONFIG =
  Object.freeze({
    provider:
      'SETTLEMENT_ENGINE',

    defaultCurrency:
      DEFAULT_CURRENCY,

    varianceTolerance:
      0.01,

    minimumSettlementAmount:
      0.01,

    maximumSettlementAmount:
      Number.MAX_SAFE_INTEGER,

    maxIdentifierLength:
      256,

    maxMetadataKeys:
      100,

    maxStateHistoryEntries:
      100,

    maxAuditEvidenceEntries:
      100,

    maxReversalReasonLength:
      500,

    failOnAuditError:
      false,

    enableInMemoryIdempotency:
      true,

    maxIdempotencyEntries:
      10000,

    requireTenantId:
      false,

    requireProviderReference:
      false,

    requireTransactionId:
      false,

    enableAccountingHook:
      true,

    emitEvents:
      true,

    allowDirectReversal:
      true,

    preventCrossTenantLookup:
      true,
  });

/**
 * ============================================================================
 * LOGGER
 * ============================================================================
 */

let logger;

try {
  logger = require('./logger');
} catch (error) {
  logger = console;
}

/**
 * ============================================================================
 * UTILITY HELPERS
 * ============================================================================
 */

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

function isoNow() {
  return new Date().toISOString();
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

/**
 * ============================================================================
 * MOBILE MONEY SETTLEMENT SERVICE
 * ============================================================================
 */

class MobileMoneySettlementService
  extends EventEmitter {

  constructor(options = {}) {
    super();

    this.serviceName =
      SERVICE_NAME;

    /**
     * ------------------------------------------------------------------------
     * Dependencies
     * ------------------------------------------------------------------------
     */

    this.db =
      options.db || null;

    this.auditService =
      options.auditService || null;

    this.metricsService =
      options.metricsService || null;

    this.queueService =
      options.queueService || null;

    /**
     * Optional loan accounting service.
     *
     * This is intentionally injected rather than imported directly so that
     * the existing architecture is not changed and circular dependencies
     * are avoided.
     */

    this.loanAccountingService =
      options.loanAccountingService ||
      null;

    /**
     * Optional ledger/posting service.
     *
     * Settlement service should not own financial posting. These are hooks
     * for integration with the existing financial engine.
     */

    this.ledgerService =
      options.ledgerService ||
      null;

    this.postingEngine =
      options.postingEngine ||
      null;

    this.eventBus =
      options.eventBus ||
      null;

    this.provider =
      options.provider ||
      DEFAULT_CONFIG.provider;

    this.config = {
      ...DEFAULT_CONFIG,
      ...(options.config || {}),
    };

    /**
     * ------------------------------------------------------------------------
     * Runtime state
     * ------------------------------------------------------------------------
     */

    this.startedAt =
      new Date();

    this.state =
      'initialized';

    /**
     * Process-local idempotency.
     *
     * Production distributed deployments should additionally use a
     * persistent unique index and/or Redis.
     */

    this.idempotencyStore =
      new Map();

    /**
     * Concurrent duplicate protection.
     */

    this.inFlightSettlements =
      new Map();

    /**
     * Metrics.
     */

    this.metrics =
      this.createEmptyMetrics();
  }

  /**
   * ==========================================================================
   * METRICS
   * ==========================================================================
   */

  createEmptyMetrics() {
    return {
      settlementsReceived: 0,
      settlementsValidated: 0,
      settlementsRecorded: 0,
      settlementsMatched: 0,
      settlementsSettled: 0,
      settlementsReconciled: 0,
      settlementsClosed: 0,

      settlementsFailed: 0,
      settlementsDisputed: 0,
      settlementsReversed: 0,

      duplicateSettlements: 0,
      idempotencyHits: 0,

      reconciliationAttempts: 0,
      reconciliationsSucceeded: 0,
      reconciliationsFailed: 0,

      variancesDetected: 0,
      variancesWithinTolerance: 0,
      variancesResolved: 0,

      reversalAttempts: 0,
      reversalSucceeded: 0,
      reversalFailed: 0,

      accountingHooksAttempted: 0,
      accountingHooksSucceeded: 0,
      accountingHooksFailed: 0,

      auditEvents: 0,
      auditFailures: 0,

      validationFailures: 0,
      processingErrors: 0,

      eventsEmitted: 0,
      eventFailures: 0,

      startedAt:
        isoNow(),
    };
  }

  /**
   * ==========================================================================
   * PRIMARY SETTLEMENT ENTRY POINT
   * ==========================================================================
   *
   * Supported:
   *
   * await service.recordSettlement(...)
   *
   * ==========================================================================
   */

  async recordSettlement(
    payload = {}
  ) {
    const startedAt =
      Date.now();

    let normalized;

    try {
      this.metrics
        .settlementsReceived++;

      /**
       * ---------------------------------------------------------------
       * RECEIVED
       * ---------------------------------------------------------------
       */

      normalized =
        this.normalizeSettlementPayload(
          payload
        );

      await this.recordAudit(
        'SETTLEMENT_RECEIVED',
        normalized,
        {
          tenantId:
            normalized.tenantId,
          customerId:
            normalized.customerId,
        }
      );

      this.emitSettlementEvent(
        SETTLEMENT_EVENT.RECEIVED,
        normalized
      );

      /**
       * ---------------------------------------------------------------
       * VALIDATED
       * ---------------------------------------------------------------
       */

      this.validateSettlement(
        normalized
      );

      this.metrics
        .settlementsValidated++;

      /**
       * ---------------------------------------------------------------
       * IDEMPOTENCY
       * ---------------------------------------------------------------
       */

      const idempotencyKey =
        this.buildIdempotencyKey(
          normalized
        );

      const existing =
        await this.findExistingSettlement(
          idempotencyKey,
          normalized
        );

      if (existing) {
        this.metrics
          .duplicateSettlements++;

        this.metrics
          .idempotencyHits++;

        this.logInfo(
          '[SETTLEMENT] Idempotent replay',
          {
            settlementId:
              existing.settlementId ||
              existing.id,

            reference:
              normalized.reference,

            provider:
              normalized.provider,

            tenantId:
              normalized.tenantId,
          }
        );

        return {
          success: true,
          duplicate: true,
          idempotent: true,
          settlement:
            clone(existing),
        };
      }

      /**
       * ---------------------------------------------------------------
       * CONCURRENT DUPLICATE
       * ---------------------------------------------------------------
       */

      if (
        this.inFlightSettlements.has(
          idempotencyKey
        )
      ) {
        this.metrics
          .duplicateSettlements++;

        this.metrics
          .idempotencyHits++;

        return this.inFlightSettlements.get(
          idempotencyKey
        );
      }

      /**
       * ---------------------------------------------------------------
       * PROCESS
       * ---------------------------------------------------------------
       */

      const operation =
        this.processSettlement(
          normalized,
          idempotencyKey,
          startedAt
        );

      this.inFlightSettlements.set(
        idempotencyKey,
        operation
      );

      try {
        return await operation;
      } finally {
        this.inFlightSettlements.delete(
          idempotencyKey
        );
      }
    } catch (error) {
      this.metrics
        .settlementsFailed++;

      this.metrics
        .processingErrors++;

      await this.recordAudit(
        'SETTLEMENT_PROCESSING_FAILED',
        {
          reference:
            normalized?.reference,

          provider:
            normalized?.provider,

          transactionId:
            normalized?.transactionId,

          tenantId:
            normalized?.tenantId,

          error:
            error.message,
        },
        {
          tenantId:
            normalized?.tenantId,
          customerId:
            normalized?.customerId,
          suppressFailure:
            true,
        }
      );

      this.emitSettlementEvent(
        SETTLEMENT_EVENT.FAILED,
        {
          reference:
            normalized?.reference,

          provider:
            normalized?.provider,

          transactionId:
            normalized?.transactionId,

          tenantId:
            normalized?.tenantId,

          error:
            error.message,
        }
      );

      this.logError(
        '[SETTLEMENT] Processing failed',
        error,
        {
          reference:
            normalized?.reference,

          provider:
            normalized?.provider,

          transactionId:
            normalized?.transactionId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * BACKWARD COMPATIBILITY
   * ==========================================================================
   *
   * This fixes the previous MTN integration issue:
   *
   * mtnMomoService.js:
   *
   * settlementService.postSettlement(...)
   *
   * now resolves correctly.
   *
   * postSettlement() delegates into the same authoritative lifecycle.
   * ==========================================================================
   */

  async postSettlement(
    payload = {}
  ) {
    return this.recordSettlement(
      payload
    );
  }

  /**
   * ==========================================================================
   * PROCESS SETTLEMENT
   * ==========================================================================
   */

  async processSettlement(
    payload,
    idempotencyKey,
    startedAt
  ) {
    const settlement =
      this.createSettlementRecord(
        payload,
        idempotencyKey
      );

    try {
      /**
       * ---------------------------------------------------------------
       * Persist immutable initial record
       * ---------------------------------------------------------------
       */

      await this.persistSettlement(
        settlement
      );

      /**
       * ---------------------------------------------------------------
       * Remember idempotency
       * ---------------------------------------------------------------
       */

      this.rememberIdempotency(
        idempotencyKey,
        settlement
      );

      this.metrics
        .settlementsRecorded++;

      await this.recordAudit(
        'SETTLEMENT_RECORDED',
        settlement,
        {
          tenantId:
            settlement.tenantId,

          customerId:
            settlement.customerId,
        }
      );

      this.emitSettlementEvent(
        SETTLEMENT_EVENT.RECORDED,
        settlement
      );

      /**
       * ---------------------------------------------------------------
       * Provider/reference matching
       * ---------------------------------------------------------------
       */

      if (
        settlement.providerReference ||
        settlement.transactionId ||
        settlement.reference
      ) {
        await this.transitionSettlement(
          settlement,
          SETTLEMENT_STATUS.MATCHED,
          {
            reason:
              'Provider/internal transaction correlation established',
          }
        );

        this.metrics
          .settlementsMatched++;
      }

      /**
       * ---------------------------------------------------------------
       * Settlement confirmation
       * ---------------------------------------------------------------
       *
       * If provider explicitly says SETTLED, transition.
       *
       * Otherwise leave lifecycle at MATCHED.
       */

      if (
        payload.status ===
          SETTLEMENT_STATUS.SETTLED ||
        payload.status ===
          'SUCCESSFUL' ||
        payload.status ===
          'SUCCESS'
      ) {
        await this.transitionSettlement(
          settlement,
          SETTLEMENT_STATUS.SETTLED,
          {
            reason:
              'Provider settlement confirmation received',
          }
        );

        this.metrics
          .settlementsSettled++;

        await this.recordAudit(
          'SETTLEMENT_CONFIRMED',
          settlement,
          {
            tenantId:
              settlement.tenantId,

            customerId:
              settlement.customerId,
          }
        );

        this.emitSettlementEvent(
          SETTLEMENT_EVENT.SETTLED,
          settlement
        );
      }

      /**
       * ---------------------------------------------------------------
       * Accounting hook
       * ---------------------------------------------------------------
       *
       * Settlement service never updates balances itself.
       */

      if (
        settlement.status ===
          SETTLEMENT_STATUS.SETTLED &&
        this.config
          .enableAccountingHook
      ) {
        await this.invokeAccountingHook(
          settlement
        );
      }

      settlement.processingDurationMs =
        Date.now() -
        startedAt;

      /**
       * ---------------------------------------------------------------
       * Append lifecycle observation.
       * ---------------------------------------------------------------
       */

      await this.appendLifecycleEvent(
        settlement,
        {
          event:
            'SETTLEMENT_PROCESSED',

          status:
            settlement.status,

          processingDurationMs:
            settlement.processingDurationMs,
        }
      );

      this.logInfo(
        '[SETTLEMENT] Processed',
        {
          settlementId:
            settlement.settlementId,

          reference:
            settlement.reference,

          provider:
            settlement.provider,

          providerReference:
            settlement.providerReference,

          status:
            settlement.status,

          tenantId:
            settlement.tenantId,

          amount:
            settlement.amount,

          currency:
            settlement.currency,

          durationMs:
            settlement.processingDurationMs,
        }
      );

      return {
        success: true,
        duplicate: false,
        idempotent: true,
        settlement:
          clone(settlement),
      };
    } catch (error) {
      await this.appendLifecycleEvent(
        settlement,
        {
          event:
            'SETTLEMENT_PROCESSING_FAILED',

          status:
            SETTLEMENT_STATUS.FAILED,

          error:
            error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * CREATE SETTLEMENT RECORD
   * ==========================================================================
   */

  createSettlementRecord(
    payload,
    idempotencyKey
  ) {
    const timestamp =
      isoNow();

    const initialStatus =
      SETTLEMENT_STATUS.RECORDED;

    const record = {
      settlementId:
        payload.settlementId ||
        crypto.randomUUID(),

      idempotencyKey,

      service:
        SERVICE_NAME,

      provider:
        payload.provider,

      providerReference:
        payload.providerReference ||
        null,

      providerTransactionId:
        payload.providerTransactionId ||
        null,

      reference:
        payload.reference,

      transactionId:
        payload.transactionId,

      transactionType:
        payload.transactionType,

      tenantId:
        payload.tenantId,

      customerId:
        payload.customerId,

      memberId:
        payload.memberId,

      loanId:
        payload.loanId,

      accountId:
        payload.accountId,

      amount:
        payload.amount,

      currency:
        payload.currency,

      settlementDate:
        payload.settlementDate,

      status:
        initialStatus,

      reconciliationStatus:
        RECONCILIATION_STATUS.UNRECONCILED,

      varianceStatus:
        VARIANCE_STATUS.NONE,

      varianceAmount:
        0,

      internalAmount:
        null,

      providerAmount:
        null,

      reversalOf:
        null,

      reversalReason:
        null,

      metadata:
        clone(
          payload.metadata
        ),

      lifecycle:
        [
          {
            event:
              'SETTLEMENT_CREATED',

            status:
              initialStatus,

            timestamp,
          },
        ],

      auditEvidence:
        [],

      createdAt:
        timestamp,

      updatedAt:
        timestamp,

      processingDurationMs:
        null,
    };

    return record;
  }

  /**
   * ==========================================================================
   * NORMALIZATION
   * ==========================================================================
   */

  normalizeSettlementPayload(
    payload
  ) {
    if (!isObject(payload)) {
      const error =
        new Error(
          'Settlement payload must be an object'
        );

      error.code =
        'INVALID_SETTLEMENT_PAYLOAD';

      throw error;
    }

    const normalized = {
      settlementId:
        this.normalizeIdentifier(
          payload.settlementId
        ),

      reference:
        this.normalizeIdentifier(
          payload.reference
        ),

      provider:
        this.normalizeIdentifier(
          payload.provider
        ) ||
        this.provider,

      providerReference:
        this.normalizeIdentifier(
          payload.providerReference ||
          payload.externalId ||
          payload.providerTransactionId
        ),

      providerTransactionId:
        this.normalizeIdentifier(
          payload.providerTransactionId
        ),

      transactionId:
        this.normalizeIdentifier(
          payload.transactionId
        ),

      transactionType:
        this.normalizeIdentifier(
          payload.transactionType
        ) ||
        'MOBILE_MONEY',

      tenantId:
        this.normalizeIdentifier(
          payload.tenantId
        ),

      customerId:
        this.normalizeIdentifier(
          payload.customerId
        ),

      memberId:
        this.normalizeIdentifier(
          payload.memberId
        ),

      loanId:
        this.normalizeIdentifier(
          payload.loanId
        ),

      accountId:
        this.normalizeIdentifier(
          payload.accountId
        ),

      amount:
        this.normalizeAmount(
          payload.amount
        ),

      currency:
        String(
          payload.currency ||
            this.config
              .defaultCurrency
        )
          .trim()
          .toUpperCase(),

      settlementDate:
        payload.settlementDate ||
        isoNow(),

      status:
        String(
          payload.status ||
            SETTLEMENT_STATUS.RECORDED
        )
          .trim()
          .toUpperCase(),

      metadata:
        this.sanitizeMetadata(
          payload.metadata
        ),
    };

    return normalized;
  }

  /**
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  validateSettlement(
    settlement
  ) {
    const errors = [];

    if (
      this.config.requireTenantId &&
      !settlement.tenantId
    ) {
      errors.push(
        'tenantId is required'
      );
    }

    if (
      !settlement.reference &&
      !settlement.transactionId &&
      !settlement.providerReference
    ) {
      errors.push(
        'reference, transactionId or providerReference is required'
      );
    }

    if (
      this.config
        .requireProviderReference &&
      !settlement.providerReference
    ) {
      errors.push(
        'providerReference is required'
      );
    }

    if (
      this.config
        .requireTransactionId &&
      !settlement.transactionId
    ) {
      errors.push(
        'transactionId is required'
      );
    }

    if (
      !Number.isFinite(
        settlement.amount
      )
    ) {
      errors.push(
        'amount must be a finite number'
      );
    }

    if (
      settlement.amount <
      this.config
        .minimumSettlementAmount
    ) {
      errors.push(
        'amount must be greater than zero'
      );
    }

    if (
      settlement.amount >
      this.config
        .maximumSettlementAmount
    ) {
      errors.push(
        'amount exceeds maximum supported settlement amount'
      );
    }

    if (
      !settlement.currency ||
      settlement.currency.length !== 3
    ) {
      errors.push(
        'currency must be a valid 3-character currency code'
      );
    }

    /**
     * The provider's raw status is normalized but lifecycle transitions
     * are controlled internally.
     */

    const externalStatuses =
      new Set([
        'SUCCESS',
        'SUCCESSFUL',
        'FAILED',
        'PENDING',
        'SETTLED',
        'RECEIVED',
        'VALIDATED',
        'RECORDED',
      ]);

    if (
      !VALID_STATUSES.has(
        settlement.status
      ) &&
      !externalStatuses.has(
        settlement.status
      )
    ) {
      errors.push(
        `invalid settlement status: ${settlement.status}`
      );
    }

    if (
      settlement.settlementDate &&
      Number.isNaN(
        Date.parse(
          settlement.settlementDate
        )
      )
    ) {
      errors.push(
        'settlementDate must be a valid date'
      );
    }

    if (
      errors.length > 0
    ) {
      this.metrics
        .validationFailures++;

      const error =
        new Error(
          `Invalid settlement: ${errors.join('; ')}`
        );

      error.code =
        'INVALID_SETTLEMENT';

      error.details =
        errors;

      throw error;
    }

    return true;
  }

  /**
   * ==========================================================================
   * AMOUNT NORMALIZATION
   * ==========================================================================
   */

  normalizeAmount(
    amount
  ) {
    if (
      amount === undefined ||
      amount === null ||
      amount === ''
    ) {
      return NaN;
    }

    const numeric =
      Number(amount);

    if (
      !Number.isFinite(
        numeric
      )
    ) {
      return NaN;
    }

    return Number(
      numeric.toFixed(2)
    );
  }

  /**
   * ==========================================================================
   * IDENTIFIER NORMALIZATION
   * ==========================================================================
   */

  normalizeIdentifier(
    value
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return null;
    }

    const normalized =
      String(value).trim();

    if (!normalized) {
      return null;
    }

    return normalized.slice(
      0,
      this.config
        .maxIdentifierLength
    );
  }

  /**
   * ==========================================================================
   * METADATA SANITIZATION
   * ==========================================================================
   */

  sanitizeMetadata(
    metadata
  ) {
    if (
      !metadata ||
      typeof metadata !==
        'object' ||
      Array.isArray(metadata)
    ) {
      return {};
    }

    const keys =
      Object.keys(metadata)
        .slice(
          0,
          this.config
            .maxMetadataKeys
        );

    const result = {};

    for (
      const key of keys
    ) {
      result[key] =
        clone(metadata[key]);
    }

    return result;
  }

  /**
   * ==========================================================================
   * IDEMPOTENCY KEY
   * ==========================================================================
   *
   * Tenant is deliberately included.
   *
   * This prevents a transaction belonging to tenant A from colliding with
   * the same provider/reference combination belonging to tenant B.
   */

  buildIdempotencyKey(
    settlement
  ) {
    const raw = [
      settlement.tenantId || 'global',
      settlement.provider,
      settlement.reference || '',
      settlement.providerReference || '',
      settlement.transactionId || '',
      settlement.amount,
      settlement.currency,
    ].join('|');

    return crypto
      .createHash('sha256')
      .update(raw)
      .digest('hex');
  }

  /**
   * ==========================================================================
   * FIND EXISTING SETTLEMENT
   * ==========================================================================
   */

  async findExistingSettlement(
    idempotencyKey,
    settlement
  ) {
    /**
     * ---------------------------------------------------------------
     * Process-local store
     * ---------------------------------------------------------------
     */

    if (
      this.config
        .enableInMemoryIdempotency
    ) {
      const cached =
        this.idempotencyStore.get(
          idempotencyKey
        );

      if (
        cached &&
        this.sameTenant(
          cached,
          settlement
        )
      ) {
        return cached;
      }
    }

    /**
     * ---------------------------------------------------------------
     * Persistent repository
     * ---------------------------------------------------------------
     */

    const repository =
      this.getSettlementRepository();

    if (!repository) {
      return null;
    }

    try {
      if (
        typeof repository
          .findOne ===
        'function'
      ) {
        const result =
          await repository.findOne({
            idempotencyKey,
            ...(this.config
              .preventCrossTenantLookup
              ? {
                  tenantId:
                    settlement.tenantId ||
                    null,
                }
              : {}),
          });

        if (
          result &&
          this.sameTenant(
            result,
            settlement
          )
        ) {
          return result;
        }
      }

      if (
        typeof repository
          .findByIdempotencyKey ===
        'function'
      ) {
        const result =
          await repository
            .findByIdempotencyKey(
              idempotencyKey,
              settlement.tenantId ||
                null
            );

        if (
          result &&
          this.sameTenant(
            result,
            settlement
          )
        ) {
          return result;
        }
      }
    } catch (error) {
      this.logError(
        '[SETTLEMENT] Persistent idempotency lookup failed',
        error,
        {
          idempotencyKey,
          reference:
            settlement.reference,
          tenantId:
            settlement.tenantId,
        }
      );

      /**
       * Do not manufacture an idempotent response when persistence
       * cannot be checked.
       */
    }

    return null;
  }

  /**
   * ==========================================================================
   * TENANT ISOLATION
   * ==========================================================================
   */

  sameTenant(
    existing,
    incoming
  ) {
    if (
      !this.config
        .preventCrossTenantLookup
    ) {
      return true;
    }

    return (
      (existing?.tenantId ||
        null) ===
      (incoming?.tenantId ||
        null)
    );
  }

  /**
   * ==========================================================================
   * PERSIST SETTLEMENT
   * ==========================================================================
   */

  async persistSettlement(
    settlement
  ) {
    const repository =
      this.getSettlementRepository();

    if (!repository) {
      return settlement;
    }

    const immutablePayload =
      Object.freeze(
        clone(settlement)
      );

    if (
      typeof repository
        .create ===
      'function'
    ) {
      return repository.create(
        immutablePayload
      );
    }

    if (
      typeof repository
        .insert ===
      'function'
    ) {
      return repository.insert(
        immutablePayload
      );
    }

    if (
      typeof repository
        .save ===
      'function'
    ) {
      return repository.save(
        immutablePayload
      );
    }

    return settlement;
  }

  /**
   * ==========================================================================
   * REPOSITORY RESOLUTION
   * ==========================================================================
   */

  getSettlementRepository() {
    if (!this.db) {
      return null;
    }

    return (
      this.db.mobileMoneySettlements ||
      this.db.settlements ||
      null
    );
  }

  /**
   * ==========================================================================
   * IDEMPOTENCY MEMORY
   * ==========================================================================
   */

  rememberIdempotency(
    key,
    settlement
  ) {
    if (
      !this.config
        .enableInMemoryIdempotency
    ) {
      return;
    }

    this.idempotencyStore.set(
      key,
      clone(settlement)
    );

    while (
      this.idempotencyStore
        .size >
      this.config
        .maxIdempotencyEntries
    ) {
      const firstKey =
        this.idempotencyStore
          .keys()
          .next()
          .value;

      if (!firstKey) {
        break;
      }

      this.idempotencyStore.delete(
        firstKey
      );
    }
  }

  /**
   * ==========================================================================
   * STATE TRANSITION
   * ==========================================================================
   */

  async transitionSettlement(
    settlement,
    nextStatus,
    context = {}
  ) {
    if (
      !VALID_STATUSES.has(
        nextStatus
      )
    ) {
      const error =
        new Error(
          `Invalid settlement status: ${nextStatus}`
        );

      error.code =
        'INVALID_SETTLEMENT_STATUS';

      throw error;
    }

    const currentStatus =
      settlement.status;

    /**
     * Same-state transitions are idempotent.
     */

    if (
      currentStatus ===
      nextStatus
    ) {
      return settlement;
    }

    const allowed =
      ALLOWED_TRANSITIONS[
        currentStatus
      ];

    if (
      !allowed ||
      !allowed.has(
        nextStatus
      )
    ) {
      const error =
        new Error(
          `Invalid settlement transition: ${currentStatus} -> ${nextStatus}`
        );

      error.code =
        'INVALID_SETTLEMENT_TRANSITION';

      error.details = {
        settlementId:
          settlement.settlementId,

        currentStatus,

        requestedStatus:
          nextStatus,
      };

      throw error;
    }

    const previousStatus =
      settlement.status;

    /**
     * We intentionally mutate only the in-memory working copy.
     *
     * The persistence layer should store lifecycle transitions append-only.
     */

    settlement.status =
      nextStatus;

    settlement.updatedAt =
      isoNow();

    await this.appendLifecycleEvent(
      settlement,
      {
        event:
          'STATUS_CHANGED',

        from:
          previousStatus,

        to:
          nextStatus,

        reason:
          context.reason ||
          null,

        actor:
          context.actor ||
          'SYSTEM',

        timestamp:
          isoNow(),
      }
    );

    await this.recordAudit(
      'SETTLEMENT_STATUS_CHANGED',
      {
        settlementId:
          settlement.settlementId,

        reference:
          settlement.reference,

        tenantId:
          settlement.tenantId,

        from:
          previousStatus,

        to:
          nextStatus,

        reason:
          context.reason ||
          null,
      },
      {
        tenantId:
          settlement.tenantId,

        customerId:
          settlement.customerId,
      }
    );

    return settlement;
  }

  /**
   * ==========================================================================
   * APPEND LIFECYCLE EVENT
   * ==========================================================================
   */

  async appendLifecycleEvent(
    settlement,
    event
  ) {
    if (
      !Array.isArray(
        settlement.lifecycle
      )
    ) {
      settlement.lifecycle =
        [];
    }

    if (
      settlement.lifecycle.length >=
      this.config
        .maxStateHistoryEntries
    ) {
      settlement.lifecycle.shift();
    }

    settlement.lifecycle.push(
      clone(event)
    );

    settlement.updatedAt =
      isoNow();

    return settlement;
  }

  /**
   * ==========================================================================
   * MATCH PROVIDER TRANSACTION
   * ==========================================================================
   *
   * Allows MTN/Airtel callbacks or transaction lookup responses to establish
   * provider/internal correlation without directly changing financial
   * balances.
   */

  async matchSettlement(
    payload = {}
  ) {
    const settlement =
      await this.resolveSettlement(
        payload
      );

    if (!settlement) {
      const error =
        new Error(
          'Settlement could not be located for matching'
        );

      error.code =
        'SETTLEMENT_NOT_FOUND';

      throw error;
    }

    if (
      payload.providerReference
    ) {
      settlement.providerReference =
        this.normalizeIdentifier(
          payload.providerReference
        );
    }

    if (
      payload.providerTransactionId
    ) {
      settlement.providerTransactionId =
        this.normalizeIdentifier(
          payload.providerTransactionId
        );
    }

    if (
      payload.transactionId
    ) {
      settlement.transactionId =
        this.normalizeIdentifier(
          payload.transactionId
        );
    }

    await this.transitionSettlement(
      settlement,
      SETTLEMENT_STATUS.MATCHED,
      {
        reason:
          'Provider/internal transaction correlation established',

        actor:
          payload.actor ||
          'SYSTEM',
      }
    );

    this.metrics
      .settlementsMatched++;

    await this.persistLifecycleUpdate(
      settlement
    );

    this.emitSettlementEvent(
      SETTLEMENT_EVENT.MATCHED,
      settlement
    );

    return {
      success: true,
      settlement:
        clone(settlement),
    };
  }

  /**
   * ==========================================================================
   * CONFIRM SETTLEMENT
   * ==========================================================================
   */

  async confirmSettlement(
    payload = {}
  ) {
    const settlement =
      await this.resolveSettlement(
        payload
      );

    if (!settlement) {
      const error =
        new Error(
          'Settlement could not be located'
        );

      error.code =
        'SETTLEMENT_NOT_FOUND';

      throw error;
    }

    await this.transitionSettlement(
      settlement,
      SETTLEMENT_STATUS.SETTLED,
      {
        reason:
          payload.reason ||
          'Provider settlement confirmed',

        actor:
          payload.actor ||
          'SYSTEM',
      }
    );

    this.metrics
      .settlementsSettled++;

    await this.recordAudit(
      'SETTLEMENT_CONFIRMED',
      settlement,
      {
        tenantId:
          settlement.tenantId,

        customerId:
          settlement.customerId,
      }
    );

    await this.invokeAccountingHook(
      settlement
    );

    await this.persistLifecycleUpdate(
      settlement
    );

    this.emitSettlementEvent(
      SETTLEMENT_EVENT.SETTLED,
      settlement
    );

    return {
      success: true,
      settlement:
        clone(settlement),
    };
  }

  /**
   * ==========================================================================
   * ACCOUNTING INTEGRATION
   * ==========================================================================
   *
   * IMPORTANT:
   *
   * This service does not modify balances.
   *
   * For loan-related settlements, the settlement is passed to the
   * LoanAccountingService which should route the operation into the
   * existing Ledger/Posting Engine.
   */

  async invokeAccountingHook(
    settlement
  ) {
    if (
      !this.config
        .enableAccountingHook
    ) {
      return {
        success: true,
        skipped: true,
      };
    }

    this.metrics
      .accountingHooksAttempted++;

    if (
      !this.loanAccountingService
    ) {
      /**
       * Accounting dependency is intentionally optional for backward
       * compatibility.
       */

      return {
        success: true,
        skipped: true,
        reason:
          'LoanAccountingService not configured',
      };
    }

    try {
      let result;

      if (
        settlement.transactionType ===
          'LOAN_REPAYMENT' ||
        settlement.transactionType ===
          'LOAN_DISBURSEMENT' ||
        settlement.loanId
      ) {
        if (
          settlement.transactionType ===
            'LOAN_DISBURSEMENT'
        ) {
          if (
            typeof this
              .loanAccountingService
              .recordDisbursement ===
            'function'
          ) {
            result =
              await this
                .loanAccountingService
                .recordDisbursement({
                  tenantId:
                    settlement.tenantId,

                  customerId:
                    settlement.customerId,

                  memberId:
                    settlement.memberId,

                  loanId:
                    settlement.loanId,

                  accountId:
                    settlement.accountId,

                  amount:
                    settlement.amount,

                  currency:
                    settlement.currency,

                  provider:
                    settlement.provider,

                  reference:
                    settlement.reference,

                  operationId:
                    `settlement:${settlement.settlementId}`,

                  metadata: {
                    settlementId:
                      settlement.settlementId,

                    providerReference:
                      settlement.providerReference,

                    providerTransactionId:
                      settlement.providerTransactionId,
                  },
                });
          }
        } else if (
          typeof this
            .loanAccountingService
            .recordRepayment ===
          'function'
        ) {
          result =
            await this
              .loanAccountingService
              .recordRepayment({
                tenantId:
                  settlement.tenantId,

                customerId:
                  settlement.customerId,

                memberId:
                  settlement.memberId,

                loanId:
                  settlement.loanId,

                accountId:
                  settlement.accountId,

                amount:
                  settlement.amount,

                currency:
                  settlement.currency,

                provider:
                  settlement.provider,

                reference:
                  settlement.reference,

                operationId:
                  `settlement:${settlement.settlementId}`,

                metadata: {
                  settlementId:
                    settlement.settlementId,

                  providerReference:
                    settlement.providerReference,

                  providerTransactionId:
                    settlement.providerTransactionId,
                },
              });
        }
      }

      this.metrics
        .accountingHooksSucceeded++;

      await this.appendLifecycleEvent(
        settlement,
        {
          event:
            'ACCOUNTING_HOOK_COMPLETED',

          timestamp:
            isoNow(),

          accountingResult:
            this.safeAccountingResult(
              result
            ),
        }
      );

      return {
        success: true,
        result,
      };
    } catch (error) {
      this.metrics
        .accountingHooksFailed++;

      await this.appendLifecycleEvent(
        settlement,
        {
          event:
            'ACCOUNTING_HOOK_FAILED',

          timestamp:
            isoNow(),

          error:
            error.message,

          code:
            error.code,
        }
      );

      await this.recordAudit(
        'SETTLEMENT_ACCOUNTING_FAILED',
        {
          settlementId:
            settlement.settlementId,

          reference:
            settlement.reference,

          loanId:
            settlement.loanId,

          error:
            error.message,

          code:
            error.code,
        },
        {
          tenantId:
            settlement.tenantId,

          customerId:
            settlement.customerId,

          suppressFailure:
            true,
        }
      );

      throw error;
    }
  }

  /**
   * Prevent large/internal accounting results from becoming settlement
   * lifecycle data.
   */

  safeAccountingResult(
    result
  ) {
    if (!result) {
      return null;
    }

    return {
      success:
        result.success,

      operationId:
        result.operationId,

      transactionType:
        result.transactionType,

      posting:
        result.posting
          ? {
              posted:
                result.posting.posted,

              journalId:
                result.posting.journalId,

              mode:
                result.posting.mode,
            }
          : undefined,
    };
  }

  /**
   * ==========================================================================
   * RECONCILIATION
   * ==========================================================================
   */

  async reconcileSettlement(
    payload = {}
  ) {
    const startedAt =
      Date.now();

    this.metrics
      .reconciliationAttempts++;

    let settlement = null;

    try {
      settlement =
        await this.resolveSettlement(
          payload
        );

      /**
       * ---------------------------------------------------------------
       * Support reconciliation of an externally supplied settlement
       * where persistence lookup is not available.
       * ---------------------------------------------------------------
       */

      const internalAmount =
        this.normalizeAmount(
          payload.internalAmount ??
          settlement?.amount
        );

      const providerAmount =
        this.normalizeAmount(
          payload.providerAmount
        );

      if (
        !Number.isFinite(
          internalAmount
        ) ||
        !Number.isFinite(
          providerAmount
        )
      ) {
        const error =
          new Error(
            'internalAmount and providerAmount must be valid numbers'
          );

        error.code =
          'INVALID_RECONCILIATION_AMOUNT';

        this.metrics
          .validationFailures++;

        throw error;
      }

      const variance =
        await this.detectVariance({
          internalAmount,
          providerAmount,
        });

      if (settlement) {
        settlement.internalAmount =
          internalAmount;

        settlement.providerAmount =
          providerAmount;

        settlement.varianceAmount =
          variance.varianceAmount;

        if (
          variance.varianceDetected
        ) {
          settlement.varianceStatus =
            VARIANCE_STATUS.DETECTED;

          settlement.reconciliationStatus =
            RECONCILIATION_STATUS.VARIANCE;

          await this.appendLifecycleEvent(
            settlement,
            {
              event:
                'VARIANCE_DETECTED',

              varianceAmount:
                variance.varianceAmount,

              internalAmount,

              providerAmount,

              timestamp:
                isoNow(),
            }
          );

          this.emitSettlementEvent(
            SETTLEMENT_EVENT.VARIANCE_DETECTED,
            settlement
          );

          await this.recordAudit(
            'SETTLEMENT_VARIANCE_DETECTED',
            {
              settlementId:
                settlement.settlementId,

              reference:
                settlement.reference,

              internalAmount,

              providerAmount,

              varianceAmount:
                variance.varianceAmount,
            },
            {
              tenantId:
                settlement.tenantId,

              customerId:
                settlement.customerId,
            }
          );

          /**
           * Do not silently mark a settlement reconciled when a variance
           * exists.
           */

          if (
            settlement.status ===
            SETTLEMENT_STATUS.SETTLED
          ) {
            await this.transitionSettlement(
              settlement,
              SETTLEMENT_STATUS.DISPUTED,
              {
                reason:
                  'Settlement variance detected',
              }
            );

            this.metrics
              .settlementsDisputed++;
          }
        } else {
          settlement.varianceStatus =
            VARIANCE_STATUS.NONE;

          settlement.reconciliationStatus =
            RECONCILIATION_STATUS.RECONCILED;

          /**
           * SETTLED -> RECONCILED
           */

          if (
            settlement.status ===
            SETTLEMENT_STATUS.SETTLED
          ) {
            await this.transitionSettlement(
              settlement,
              SETTLEMENT_STATUS.RECONCILED,
              {
                reason:
                  'Internal and provider settlement amounts matched',
              }
            );

            this.metrics
              .settlementsReconciled++;

            this.emitSettlementEvent(
              SETTLEMENT_EVENT.RECONCILED,
              settlement
            );
          }
        }

        await this.persistLifecycleUpdate(
          settlement
        );
      }

      const result = {
        success: true,

        reconciled:
          !variance.varianceDetected,

        reference:
          payload.reference ||
          settlement?.reference ||
          null,

        settlementId:
          settlement?.settlementId ||
          payload.settlementId ||
          null,

        tenantId:
          settlement?.tenantId ||
          payload.tenantId ||
          null,

        internalAmount,

        providerAmount,

        variance,

        reconciliationStatus:
          variance.varianceDetected
            ? RECONCILIATION_STATUS.VARIANCE
            : RECONCILIATION_STATUS.RECONCILED,

        reconciledAt:
          isoNow(),

        durationMs:
          Date.now() -
          startedAt,
      };

      this.metrics
        .reconciliationsSucceeded++;

      await this.recordAudit(
        'SETTLEMENT_RECONCILIATION',
        result,
        {
          tenantId:
            result.tenantId,

          customerId:
            settlement?.customerId ||
            payload.customerId ||
            null,
        }
      );

      return result;
    } catch (error) {
      this.metrics
        .reconciliationsFailed++;

      await this.recordAudit(
        'SETTLEMENT_RECONCILIATION_FAILED',
        {
          reference:
            payload.reference,

          settlementId:
            settlement?.settlementId ||
            payload.settlementId,

          error:
            error.message,
        },
        {
          tenantId:
            settlement?.tenantId ||
            payload.tenantId ||
            null,

          customerId:
            settlement?.customerId ||
            payload.customerId ||
            null,

          suppressFailure:
            true,
        }
      );

      this.logError(
        '[SETTLEMENT] Reconciliation failed',
        error,
        {
          reference:
            payload.reference,

          settlementId:
            settlement?.settlementId ||
            payload.settlementId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * VARIANCE DETECTION
   * ==========================================================================
   */

  async detectVariance({
    internalAmount = 0,
    providerAmount = 0,
  } = {}) {
    const internal =
      this.normalizeAmount(
        internalAmount
      );

    const provider =
      this.normalizeAmount(
        providerAmount
      );

    if (
      !Number.isFinite(
        internal
      ) ||
      !Number.isFinite(
        provider
      )
    ) {
      const error =
        new Error(
          'internalAmount and providerAmount must be valid numbers'
        );

      error.code =
        'INVALID_RECONCILIATION_AMOUNT';

      this.metrics
        .validationFailures++;

      throw error;
    }

    const variance =
      Number(
        Math.abs(
          internal -
            provider
        ).toFixed(2)
      );

    const varianceDetected =
      variance >
      this.config
        .varianceTolerance;

    if (
      varianceDetected
    ) {
      this.metrics
        .variancesDetected++;
    } else {
      this.metrics
        .variancesWithinTolerance++;
    }

    return {
      varianceDetected,

      varianceAmount:
        variance,

      internalAmount:
        internal,

      providerAmount:
        provider,

      tolerance:
        this.config
          .varianceTolerance,

      differenceWithinTolerance:
        !varianceDetected,
    };
  }

  /**
   * ==========================================================================
   * RESOLVE VARIANCE
   * ==========================================================================
   */

  async resolveVariance(
    payload = {}
  ) {
    const settlement =
      await this.resolveSettlement(
        payload
      );

    if (!settlement) {
      const error =
        new Error(
          'Settlement not found'
        );

      error.code =
        'SETTLEMENT_NOT_FOUND';

      throw error;
    }

    if (
      !VALID_VARIANCE_STATUSES.has(
        payload.resolutionStatus
      )
    ) {
      const error =
        new Error(
          `Invalid variance resolution status: ${payload.resolutionStatus}`
        );

      error.code =
        'INVALID_VARIANCE_STATUS';

      throw error;
    }

    if (
      ![
        VARIANCE_STATUS.RESOLVED,
        VARIANCE_STATUS.WAIVED,
      ].includes(
        payload.resolutionStatus
      )
    ) {
      const error =
        new Error(
          'Variance can only be resolved or waived through this operation'
        );

      error.code =
        'INVALID_VARIANCE_RESOLUTION';

      throw error;
    }

    settlement.varianceStatus =
      payload.resolutionStatus;

    settlement.reconciliationStatus =
      RECONCILIATION_STATUS.RESOLVED;

    await this.appendLifecycleEvent(
      settlement,
      {
        event:
          'VARIANCE_RESOLVED',

        resolutionStatus:
          payload.resolutionStatus,

        resolutionReason:
          payload.reason ||
          null,

        resolvedBy:
          payload.actor ||
          'SYSTEM',

        timestamp:
          isoNow(),
      }
    );

    this.metrics
      .variancesResolved++;

    await this.recordAudit(
      'SETTLEMENT_VARIANCE_RESOLVED',
      {
        settlementId:
          settlement.settlementId,

        reference:
          settlement.reference,

        varianceStatus:
          payload.resolutionStatus,

        reason:
          payload.reason ||
          null,

        actor:
          payload.actor ||
          'SYSTEM',
      },
      {
        tenantId:
          settlement.tenantId,

        customerId:
          settlement.customerId,
      }
    );

    await this.persistLifecycleUpdate(
      settlement
    );

    this.emitSettlementEvent(
      SETTLEMENT_EVENT.VARIANCE_RESOLVED,
      settlement
    );

    return {
      success: true,
      settlement:
        clone(settlement),
    };
  }

  /**
   * ==========================================================================
   * CLOSE SETTLEMENT
   * ==========================================================================
   *
   * Settlement can only be closed after reconciliation.
   * ==========================================================================
   */

  async closeSettlement(
    payload = {}
  ) {
    const settlement =
      await this.resolveSettlement(
        payload
      );

    if (!settlement) {
      const error =
        new Error(
          'Settlement not found'
        );

      error.code =
        'SETTLEMENT_NOT_FOUND';

      throw error;
    }

    if (
      settlement.reconciliationStatus !==
        RECONCILIATION_STATUS.RECONCILED &&
      settlement.varianceStatus !==
        VARIANCE_STATUS.RESOLVED &&
      settlement.varianceStatus !==
        VARIANCE_STATUS.WAIVED
    ) {
      const error =
        new Error(
          'Settlement cannot be closed before reconciliation or approved variance resolution'
        );

      error.code =
        'SETTLEMENT_NOT_READY_FOR_CLOSE';

      throw error;
    }

    if (
      settlement.status ===
      SETTLEMENT_STATUS.DISPUTED
    ) {
      /**
       * A disputed settlement must be resolved before closing.
       */

      if (
        settlement.varianceStatus !==
          VARIANCE_STATUS.RESOLVED &&
        settlement.varianceStatus !==
          VARIANCE_STATUS.WAIVED
      ) {
        const error =
          new Error(
            'Disputed settlement requires variance resolution before closure'
          );

        error.code =
          'SETTLEMENT_DISPUTE_UNRESOLVED';

        throw error;
      }
    }

    if (
      settlement.status !==
      SETTLEMENT_STATUS.RECONCILED
    ) {
      /**
       * For a resolved variance, transition from DISPUTED back into
       * RECONCILED before closing.
       */

      await this.transitionSettlement(
        settlement,
        SETTLEMENT_STATUS.RECONCILED,
        {
          reason:
            'Variance resolved and settlement cleared for closure',
        }
      );
    }

    await this.transitionSettlement(
      settlement,
      SETTLEMENT_STATUS.CLOSED,
      {
        reason:
          payload.reason ||
          'Settlement lifecycle completed',

        actor:
          payload.actor ||
          'SYSTEM',
      }
    );

    this.metrics
      .settlementsClosed++;

    await this.recordAudit(
      'SETTLEMENT_CLOSED',
      settlement,
      {
        tenantId:
          settlement.tenantId,

        customerId:
          settlement.customerId,
      }
    );

    await this.persistLifecycleUpdate(
      settlement
    );

    this.emitSettlementEvent(
      SETTLEMENT_EVENT.CLOSED,
      settlement
    );

    return {
      success: true,
      settlement:
        clone(settlement),
    };
  }

  /**
   * ==========================================================================
   * REVERSAL
   * ==========================================================================
   *
   * IMPORTANT:
   *
   * The original settlement is never deleted or edited into a reversed
   * transaction.
   *
   * A new reversal record is created.
   *
   * The Ledger/Posting Engine must ultimately create the corresponding
   * financial reversal.
   * ==========================================================================
   */

  async reverseSettlement(
    payload = {}
  ) {
    this.metrics
      .reversalAttempts++;

    if (
      !this.config
        .allowDirectReversal
    ) {
      const error =
        new Error(
          'Direct settlement reversal is disabled'
        );

      error.code =
        'SETTLEMENT_REVERSAL_DISABLED';

      throw error;
    }

    const original =
      await this.resolveSettlement(
        payload
      );

    if (!original) {
      const error =
        new Error(
          'Original settlement not found'
        );

      error.code =
        'SETTLEMENT_NOT_FOUND';

      this.metrics
        .reversalFailed++;

      throw error;
    }

    if (
      original.status ===
      SETTLEMENT_STATUS.REVERSED
    ) {
      return {
        success: true,
        alreadyReversed: true,
        settlement:
          clone(original),
      };
    }

    if (
      original.reversalOf
    ) {
      const error =
        new Error(
          'A reversal cannot itself be reversed through this operation'
        );

      error.code =
        'INVALID_REVERSAL_CHAIN';

      throw error;
    }

    const reversalReason =
      this.normalizeIdentifier(
        payload.reason
      );

    if (
      !reversalReason
    ) {
      const error =
        new Error(
          'Reversal reason is required'
        );

      error.code =
        'REVERSAL_REASON_REQUIRED';

      throw error;
    }

    if (
      reversalReason.length >
      this.config
        .maxReversalReasonLength
    ) {
      const error =
        new Error(
          'Reversal reason exceeds maximum length'
        );

      error.code =
        'REVERSAL_REASON_TOO_LONG';

      throw error;
    }

    /**
     * ---------------------------------------------------------------
     * Reversal record
     * ---------------------------------------------------------------
     */

    const reversalPayload = {
      settlementId:
        crypto.randomUUID(),

      reference:
        `REV-${original.reference || original.settlementId}-${crypto.randomUUID()}`,

      provider:
        original.provider,

      providerReference:
        original.providerReference,

      providerTransactionId:
        original.providerTransactionId,

      transactionId:
        crypto.randomUUID(),

      transactionType:
        'SETTLEMENT_REVERSAL',

      tenantId:
        original.tenantId,

      customerId:
        original.customerId,

      memberId:
        original.memberId,

      loanId:
        original.loanId,

      accountId:
        original.accountId,

      amount:
        original.amount,

      currency:
        original.currency,

      settlementDate:
        isoNow(),

      metadata: {
        reversalOf:
          original.settlementId,

        originalReference:
          original.reference,

        reversalReason,

        reversedBy:
          payload.actor ||
          'SYSTEM',
      },
    };

    const reversal =
      this.createSettlementRecord(
        this.normalizeSettlementPayload(
          reversalPayload
        ),
        this.buildIdempotencyKey(
          this.normalizeSettlementPayload(
            reversalPayload
          )
        )
      );

    reversal.reversalOf =
      original.settlementId;

    reversal.reversalReason =
      reversalReason;

    reversal.status =
      SETTLEMENT_STATUS.REVERSED;

    reversal.reconciliationStatus =
      RECONCILIATION_STATUS.UNRECONCILED;

    await this.appendLifecycleEvent(
      reversal,
      {
        event:
          'SETTLEMENT_REVERSAL_CREATED',

        reversalOf:
          original.settlementId,

        reason:
          reversalReason,

        actor:
          payload.actor ||
          'SYSTEM',

        timestamp:
          isoNow(),
      }
    );

    /**
     * ---------------------------------------------------------------
     * Persist reversal
     * ---------------------------------------------------------------
     */

    await this.persistSettlement(
      reversal
    );

    this.rememberIdempotency(
      reversal.idempotencyKey,
      reversal
    );

    /**
     * ---------------------------------------------------------------
     * Accounting reversal hook
     * ---------------------------------------------------------------
     */

    if (
      this.config
        .enableAccountingHook &&
      this.loanAccountingService
    ) {
      await this.invokeReversalAccountingHook(
        original,
        reversal
      );
    }

    /**
     * ---------------------------------------------------------------
     * Original lifecycle receives an immutable observation.
     *
     * We do not rewrite the original financial facts.
     * ---------------------------------------------------------------
     */

    await this.appendLifecycleEvent(
      original,
      {
        event:
          'REVERSAL_CREATED',

        reversalSettlementId:
          reversal.settlementId,

        reason:
          reversalReason,

        actor:
          payload.actor ||
          'SYSTEM',

        timestamp:
          isoNow(),
      }
    );

    await this.persistLifecycleUpdate(
      original
    );

    this.metrics
      .settlementsReversed++;

    this.metrics
      .reversalSucceeded++;

    await this.recordAudit(
      'SETTLEMENT_REVERSED',
      {
        originalSettlementId:
          original.settlementId,

        reversalSettlementId:
          reversal.settlementId,

        originalReference:
          original.reference,

        reversalReference:
          reversal.reference,

        amount:
          original.amount,

        reason:
          reversalReason,
      },
      {
        tenantId:
          original.tenantId,

        customerId:
          original.customerId,
      }
    );

    this.emitSettlementEvent(
      SETTLEMENT_EVENT.REVERSED,
      {
        original:
          clone(original),

        reversal:
          clone(reversal),
      }
    );

    return {
      success: true,

      originalSettlement:
        clone(original),

      reversalSettlement:
        clone(reversal),
    };
  }

  /**
   * ==========================================================================
   * REVERSAL ACCOUNTING
   * ==========================================================================
   */

  async invokeReversalAccountingHook(
    original,
    reversal
  ) {
    if (
      !this.loanAccountingService
    ) {
      return {
        success: true,
        skipped: true,
      };
    }

    try {
      /**
       * The accounting layer may expose a dedicated reversal method in
       * the future. Prefer it when available.
       */

      if (
        typeof this
          .loanAccountingService
          .reverseTransaction ===
        'function'
      ) {
        return this
          .loanAccountingService
          .reverseTransaction({
            tenantId:
              original.tenantId,

            loanId:
              original.loanId,

            originalReference:
              original.reference,

            originalSettlementId:
              original.settlementId,

            reversalSettlementId:
              reversal.settlementId,

            amount:
              original.amount,

            currency:
              original.currency,

            reason:
              reversal.reversalReason,
          });
      }

      /**
       * Do not fake a reversal through a normal repayment/disbursement
       * operation.
       *
       * The correct financial reversal requires the accounting engine to
       * support an actual reversal journal.
       */

      await this.recordAudit(
        'SETTLEMENT_REVERSAL_ACCOUNTING_PENDING',
        {
          originalSettlementId:
            original.settlementId,

          reversalSettlementId:
            reversal.settlementId,

          reason:
            'Dedicated accounting reversal method unavailable',
        },
        {
          tenantId:
            original.tenantId,

          customerId:
            original.customerId,
        }
      );

      return {
        success: true,
        pending: true,
      };
    } catch (error) {
      await this.recordAudit(
        'SETTLEMENT_REVERSAL_ACCOUNTING_FAILED',
        {
          originalSettlementId:
            original.settlementId,

          reversalSettlementId:
            reversal.settlementId,

          error:
            error.message,
        },
        {
          tenantId:
            original.tenantId,

          customerId:
            original.customerId,

          suppressFailure:
            true,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * RESOLVE SETTLEMENT
   * ==========================================================================
   */

  async resolveSettlement(
    payload = {}
  ) {
    const tenantId =
      this.normalizeIdentifier(
        payload.tenantId
      );

    const settlementId =
      this.normalizeIdentifier(
        payload.settlementId
      );

    const reference =
      this.normalizeIdentifier(
        payload.reference
      );

    const providerReference =
      this.normalizeIdentifier(
        payload.providerReference
      );

    const transactionId =
      this.normalizeIdentifier(
        payload.transactionId
      );

    /**
     * ---------------------------------------------------------------
     * Persistent repository
     * ---------------------------------------------------------------
     */

    const repository =
      this.getSettlementRepository();

    if (repository) {
      const query = {
        ...(settlementId
          ? {
              settlementId,
            }
          : {}),

        ...(reference
          ? {
              reference,
            }
          : {}),

        ...(providerReference
          ? {
              providerReference,
            }
          : {}),

        ...(transactionId
          ? {
              transactionId,
            }
          : {}),

        ...(this.config
          .preventCrossTenantLookup
          ? {
              tenantId:
                tenantId ||
                null,
            }
          : {}),
      };

      try {
        if (
          typeof repository
            .findOne ===
          'function'
        ) {
          const result =
            await repository.findOne(
              query
            );

          if (
            result &&
            this.sameTenant(
              result,
              {
                tenantId,
              }
            )
          ) {
            return result;
          }
        }

        if (
          typeof repository
            .findById ===
          'function' &&
          settlementId
        ) {
          const result =
            await repository.findById(
              settlementId,
              tenantId
            );

          if (
            result &&
            this.sameTenant(
              result,
              {
                tenantId,
              }
            )
          ) {
            return result;
          }
        }
      } catch (error) {
        this.logError(
          '[SETTLEMENT] Settlement resolution failed',
          error,
          {
            settlementId,
            reference,
            providerReference,
            transactionId,
            tenantId,
          }
        );
      }
    }

    /**
     * ---------------------------------------------------------------
     * Process-local idempotency fallback
     * ---------------------------------------------------------------
     */

    if (
      this.config
        .enableInMemoryIdempotency
    ) {
      for (
        const settlement of
        this.idempotencyStore.values()
      ) {
        if (
          !this.sameTenant(
            settlement,
            {
              tenantId,
            }
          )
        ) {
          continue;
        }

        if (
          settlementId &&
          settlement.settlementId ===
            settlementId
        ) {
          return clone(
            settlement
          );
        }

        if (
          reference &&
          settlement.reference ===
            reference
        ) {
          return clone(
            settlement
          );
        }

        if (
          providerReference &&
          settlement.providerReference ===
            providerReference
        ) {
          return clone(
            settlement
          );
        }

        if (
          transactionId &&
          settlement.transactionId ===
            transactionId
        ) {
          return clone(
            settlement
          );
        }
      }
    }

    return null;
  }

  /**
   * ==========================================================================
   * PERSIST LIFECYCLE UPDATE
   * ==========================================================================
   *
   * The preferred repository implementation should expose an append-only
   * lifecycle method.
   *
   * We intentionally do not require updateOne/save to make this service
   * pretend an immutable record is mutable.
   */

  async persistLifecycleUpdate(
    settlement
  ) {
    const repository =
      this.getSettlementRepository();

    if (!repository) {
      return settlement;
    }

    const lifecycleEvent =
      settlement.lifecycle?.[
        settlement.lifecycle.length -
          1
      ];

    if (
      typeof repository
        .appendLifecycleEvent ===
      'function'
    ) {
      return repository.appendLifecycleEvent(
        settlement.settlementId,
        lifecycleEvent,
        {
          tenantId:
            settlement.tenantId,
        }
      );
    }

    if (
      typeof repository
        .recordLifecycleEvent ===
      'function'
    ) {
      return repository.recordLifecycleEvent(
        settlement.settlementId,
        lifecycleEvent,
        {
          tenantId:
            settlement.tenantId,
        }
      );
    }

    /**
     * Compatibility fallback:
     *
     * The repository may be a simple model/store. In that case, the
     * lifecycle payload is passed through if an explicit append/update
     * operation exists.
     */

    if (
      typeof repository
        .append ===
      'function'
    ) {
      return repository.append({
        settlementId:
          settlement.settlementId,

        tenantId:
          settlement.tenantId,

        event:
          lifecycleEvent,
      });
    }

    return settlement;
  }

  /**
   * ==========================================================================
   * AUDIT
   * ==========================================================================
   */

  async recordAudit(
    event,
    data = {},
    options = {}
  ) {
    this.metrics
      .auditEvents++;

    const auditPayload = {
      event,

      service:
        SERVICE_NAME,

      timestamp:
        isoNow(),

      tenantId:
        options.tenantId ||
        data?.tenantId ||
        null,

      customerId:
        options.customerId ||
        data?.customerId ||
        null,

      data:
        clone(data),
    };

    try {
      if (
        this.auditService &&
        typeof this.auditService
          .log ===
          'function'
      ) {
        await this.auditService.log({
          tenantId:
            auditPayload.tenantId,

          customerId:
            auditPayload.customerId,

          action:
            event,

          payload:
            auditPayload,

          timestamp:
            new Date(),
        });

        return true;
      }

      this.logInfo(
        '[SETTLEMENT AUDIT]',
        auditPayload
      );

      return true;
    } catch (error) {
      this.metrics
        .auditFailures++;

      this.logError(
        '[SETTLEMENT AUDIT] Failed',
        error,
        {
          event,
          tenantId:
            auditPayload.tenantId,
        }
      );

      if (
        this.config
          .failOnAuditError &&
        !options.suppressFailure
      ) {
        throw error;
      }

      return false;
    }
  }

  /**
   * ==========================================================================
   * EVENT EMISSION
   * ==========================================================================
   */

  emitSettlementEvent(
    event,
    payload
  ) {
    if (
      !this.config.emitEvents
    ) {
      return;
    }

    try {
      /**
       * Local EventEmitter subscribers.
       */

      this.emit(
        event,
        clone(payload)
      );

      /**
       * Optional external event bus.
       */

      if (
        this.eventBus
      ) {
        if (
          typeof this.eventBus
            .publish ===
          'function'
        ) {
          Promise.resolve(
            this.eventBus.publish(
              event,
              clone(payload)
            )
          ).catch(
            error => {
              this.metrics
                .eventFailures++;

              this.logError(
                '[SETTLEMENT] Event bus publication failed',
                error,
                {
                  event,
                }
              );
            }
          );
        } else if (
          typeof this.eventBus
            .emit ===
          'function'
        ) {
          Promise.resolve(
            this.eventBus.emit(
              event,
              clone(payload)
            )
          ).catch(
            error => {
              this.metrics
                .eventFailures++;

              this.logError(
                '[SETTLEMENT] Event bus emission failed',
                error,
                {
                  event,
                }
              );
            }
          );
        }
      }

      this.metrics
        .eventsEmitted++;
    } catch (error) {
      this.metrics
        .eventFailures++;

      this.logError(
        '[SETTLEMENT] Event emission failed',
        error,
        {
          event,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * HEALTH CHECK
   * ==========================================================================
   */

  healthCheck() {
    const repository =
      this.getSettlementRepository();

    return {
      healthy:
        this.state !==
        'failed',

      service:
        SERVICE_NAME,

      provider:
        this.provider,

      state:
        this.state,

      persistenceAvailable:
        Boolean(repository),

      auditAvailable:
        Boolean(
          this.auditService
        ),

      accountingAvailable:
        Boolean(
          this.loanAccountingService
        ),

      eventBusAvailable:
        Boolean(
          this.eventBus
        ),

      idempotencyEnabled:
        Boolean(
          this.config
            .enableInMemoryIdempotency
        ),

      startedAt:
        this.startedAt
          .toISOString(),

      uptimeSeconds:
        Math.floor(
          (Date.now() -
            this.startedAt.getTime()) /
            1000
        ),

      timestamp:
        isoNow(),
    };
  }

  /**
   * ==========================================================================
   * READINESS CHECK
   * ==========================================================================
   */

  readinessCheck() {
    const health =
      this.healthCheck();

    /**
     * Persistence is not necessarily mandatory during local development,
     * but production financial operation should normally require it.
     */

    const ready =
      health.healthy &&
      this.state !==
        'failed';

    return {
      ready,

      service:
        health.service,

      state:
        health.state,

      persistenceAvailable:
        health.persistenceAvailable,

      auditAvailable:
        health.auditAvailable,

      accountingAvailable:
        health.accountingAvailable,

      timestamp:
        isoNow(),
    };
  }

  /**
   * ==========================================================================
   * METRICS
   * ==========================================================================
   */

  getMetrics() {
    return {
      service:
        SERVICE_NAME,

      provider:
        this.provider,

      ...this.metrics,

      inFlightSettlements:
        this.inFlightSettlements
          .size,

      idempotencyEntries:
        this.idempotencyStore
          .size,

      uptimeSeconds:
        Math.floor(
          (Date.now() -
            this.startedAt.getTime()) /
            1000
        ),

      timestamp:
        isoNow(),
    };
  }

  /**
   * ==========================================================================
   * METRICS EXPORT
   * ==========================================================================
   */

  async publishMetrics() {
    const metrics =
      this.getMetrics();

    if (
      !this.metricsService
    ) {
      return metrics;
    }

    try {
      if (
        typeof this.metricsService
          .record ===
        'function'
      ) {
        await this.metricsService.record(
          'mobile_money_settlement',
          metrics
        );
      } else if (
        typeof this.metricsService
          .increment ===
        'function'
      ) {
        await this.metricsService.increment(
          'mobile_money_settlement_operations'
        );
      }
    } catch (error) {
      this.logError(
        '[SETTLEMENT] Metrics publication failed',
        error
      );
    }

    return metrics;
  }

  /**
   * ==========================================================================
   * RESET METRICS
   * ==========================================================================
   */

  resetMetrics() {
    this.metrics =
      this.createEmptyMetrics();
  }

  /**
   * ==========================================================================
   * LOGGING
   * ==========================================================================
   */

  logInfo(
    message,
    metadata = {}
  ) {
    try {
      if (
        logger &&
        typeof logger.info ===
          'function'
      ) {
        logger.info(
          message,
          metadata
        );
      }
    } catch (error) {
      /**
       * Logging must never break financial processing.
       */
    }
  }

  logError(
    message,
    error,
    metadata = {}
  ) {
    try {
      const payload = {
        ...metadata,

        error:
          error?.message ||
          String(error),

        code:
          error?.code,

        stack:
          error?.stack,
      };

      if (
        logger &&
        typeof logger.error ===
          'function'
      ) {
        logger.error(
          message,
          payload
        );
      }
    } catch (loggingError) {
      /**
       * Never mask the original financial error.
       */
    }
  }
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 *
 * Existing integrations remain valid:
 *
 * const mobileMoneySettlementService =
 *   require('./mobileMoneySettlementService');
 *
 * await mobileMoneySettlementService.recordSettlement(...);
 *
 * await mobileMoneySettlementService.postSettlement(...);
 *
 * await mobileMoneySettlementService.reconcileSettlement(...);
 *
 * await mobileMoneySettlementService.reverseSettlement(...);
 *
 * ============================================================================
 */

module.exports =
  new MobileMoneySettlementService();