/**
 * ============================================================================
 * TITech Community Capital LTD
 * ============================================================================
 * File:
 * backend/modules/loanAccountingService.js
 *
 * ENTERPRISE LOAN ACCOUNTING SERVICE
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *
 *  - Loan repayment accounting
 *  - Loan disbursement accounting
 *  - Double-entry journal construction
 *  - Existing Ledger / Posting Engine integration
 *  - Idempotent financial operations
 *  - Immutable accounting payloads
 *  - Tenant isolation
 *  - Transaction/reference correlation
 *  - Financial operation state machine
 *  - Reversal support
 *  - Settlement correlation hooks
 *  - Reconciliation hooks
 *  - Retry / DLQ hooks
 *  - Audit logging
 *  - Financial event emission
 *  - Mobile Money accounting hooks
 *  - Operational metrics
 *  - Health checks
 *  - Readiness checks
 *
 * STEP 9 REQUIRED INTEGRATION
 * ----------------------------------------------------------------------------
 *
 * Required application hook:
 *
 *   await loanAccountingService.recordRepayment(...)
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This service DOES NOT directly mutate loan balances.
 *
 * Financial state must ultimately be changed through the existing:
 *
 *   Ledger
 *   Journal
 *   Posting Engine
 *
 * No financial record should be mutated after posting.
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

const SERVICE_NAME = 'LoanAccountingService';

const PROVIDER = 'SYSTEM';

const TRANSACTION_TYPES = Object.freeze({
  REPAYMENT: 'LOAN_REPAYMENT',
  DISBURSEMENT: 'LOAN_DISBURSEMENT',
  REVERSAL: 'LOAN_ACCOUNTING_REVERSAL',
});

const ENTRY_TYPES = Object.freeze({
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
});

const OPERATION_STATUS = Object.freeze({
  CREATED: 'CREATED',
  VALIDATING: 'VALIDATING',
  READY_FOR_POSTING: 'READY_FOR_POSTING',
  POSTING: 'POSTING',
  POSTED: 'POSTED',
  SETTLED: 'SETTLED',
  RECONCILED: 'RECONCILED',
  REVERSED: 'REVERSED',
  FAILED: 'FAILED',
  RETRY_PENDING: 'RETRY_PENDING',
  DEAD_LETTERED: 'DEAD_LETTERED',
});

const DEFAULTS = Object.freeze({
  currency: 'UGX',

  maxAmount: Number.MAX_SAFE_INTEGER,

  principalTolerance: 0.01,

  enableIdempotency: true,

  idempotencyTtl: 86400,

  emitEvents: true,

  requireTenantId: false,

  requireCustomerId: false,

  requireAccountMapping: false,

  allowNegativeComponents: false,

  defaultProvider: PROVIDER,

  enableReversal: true,

  enableSettlementCorrelation: true,

  enableReconciliationHooks: true,

  enableRetryHooks: true,

  maxRetryAttempts: 3,

  retryBaseDelayMs: 1000,

  failWithoutLedger: false,

  immutableJournalPayloads: true,

  redactSensitiveAuditData: true,
});

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function toFiniteNumber(value, fieldName) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new TypeError(
      `${fieldName} must be a finite number`
    );
  }

  return number;
}

function positiveAmount(value, fieldName) {
  const amount = toFiniteNumber(
    value,
    fieldName
  );

  if (amount <= 0) {
    throw new RangeError(
      `${fieldName} must be greater than zero`
    );
  }

  return amount;
}

function nonNegativeAmount(value, fieldName) {
  const amount = toFiniteNumber(
    value,
    fieldName
  );

  if (amount < 0) {
    throw new RangeError(
      `${fieldName} cannot be negative`
    );
  }

  return amount;
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

function freezeDeep(value) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value;
  }

  Object.freeze(value);

  for (const key of Object.keys(value)) {
    if (
      value[key] &&
      typeof value[key] === 'object' &&
      !Object.isFrozen(value[key])
    ) {
      freezeDeep(value[key]);
    }
  }

  return value;
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(value)
    )
    .digest('hex');
}

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class LoanAccountingService extends EventEmitter {
  constructor(options = {}) {
    super();

    const {
      logger: injectedLogger,
      db = null,
      ledgerService = null,
      journalService = null,
      postingEngine = null,
      auditService = null,
      eventBus = null,
      cache = null,
      metricsService = null,
      settlementService = null,
      reconciliationService = null,
      queueService = null,
      config = {},
    } = options;

    this.serviceName =
      SERVICE_NAME;

    this.db = db;

    this.ledgerService =
      ledgerService;

    this.journalService =
      journalService;

    this.postingEngine =
      postingEngine;

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    this.cache =
      cache;

    this.metricsService =
      metricsService;

    this.settlementService =
      settlementService;

    this.reconciliationService =
      reconciliationService;

    this.queueService =
      queueService;

    this.logger =
      injectedLogger ||
      this.createDefaultLogger();

    this.config = {
      ...DEFAULTS,
      ...config,
    };

    this.metrics =
      this.createMetrics();

    this.serviceState = {
      startedAt:
        isoNow(),

      lastOperationAt:
        null,

      lastSuccessfulOperationAt:
        null,

      lastFailureAt:
        null,
    };
  }

  /**
   * ==========================================================================
   * DEPENDENCY CONFIGURATION
   * ==========================================================================
   *
   * Allows the singleton export to remain backwards compatible while the
   * application can inject enterprise dependencies during bootstrap.
   * ==========================================================================
   */

  configure(options = {}) {
    if (!isObject(options)) {
      throw new TypeError(
        'LoanAccountingService configuration must be an object'
      );
    }

    const allowed =
      [
        'db',
        'ledgerService',
        'journalService',
        'postingEngine',
        'auditService',
        'eventBus',
        'cache',
        'metricsService',
        'settlementService',
        'reconciliationService',
        'queueService',
        'logger',
        'config',
      ];

    for (const key of allowed) {
      if (
        Object.prototype.hasOwnProperty.call(
          options,
          key
        )
      ) {
        if (key === 'config') {
          this.config = {
            ...this.config,
            ...options.config,
          };
        } else {
          this[key] =
            options[key];
        }
      }
    }

    return this;
  }

  /**
   * ==========================================================================
   * LOGGER
   * ==========================================================================
   */

  createDefaultLogger() {
    return {
      info:
        console.info.bind(console),

      warn:
        console.warn.bind(console),

      error:
        console.error.bind(console),

      debug:
        console.debug.bind(console),
    };
  }

  /**
   * ==========================================================================
   * METRICS FACTORY
   * ==========================================================================
   */

  createMetrics() {
    return {
      repaymentsRecorded: 0,
      disbursementsRecorded: 0,

      journalEntriesCreated: 0,

      journalPostingsAttempted: 0,
      journalPostingsSucceeded: 0,
      journalPostingsFailed: 0,

      auditEvents: 0,

      idempotencyHits: 0,
      duplicateOperations: 0,

      failures: 0,
      validationFailures: 0,

      eventsPublished: 0,
      eventFailures: 0,

      reversalsCreated: 0,
      reversalFailures: 0,

      settlementsCorrelated: 0,
      reconciliationHooksTriggered: 0,

      retriesQueued: 0,
      deadLettersQueued: 0,

      stateTransitions: 0,

      startedAt:
        isoNow(),
    };
  }

  /**
   * ==========================================================================
   * RECORD LOAN REPAYMENT
   * ==========================================================================
   *
   * Required application hook:
   *
   *   await loanAccountingService.recordRepayment(...)
   *
   * ==========================================================================
   */

  async recordRepayment(
    payload = {}
  ) {
    const operationId =
      this.resolveOperationId(
        payload,
        'repayment'
      );

    this.serviceState.lastOperationAt =
      isoNow();

    try {
      const normalized =
        this.validateRepaymentPayload(
          payload
        );

      const existing =
        await this.findIdempotentOperation(
          normalized,
          operationId
        );

      if (existing) {
        this.metrics.idempotencyHits++;
        this.metrics.duplicateOperations++;

        await this.recordAudit(
          'LOAN_REPAYMENT_IDEMPOTENT_REPLAY',
          {
            tenantId:
              normalized.tenantId,

            customerId:
              normalized.customerId,

            loanId:
              normalized.loanId,

            operationId,

            reference:
              normalized.reference,
          }
        );

        return existing;
      }

      const accountingEntry =
        this.buildRepaymentEntry(
          normalized,
          operationId
        );

      const journal =
        this.buildRepaymentJournal(
          accountingEntry
        );

      this.assertImmutableJournal(
        journal
      );

      const result =
        await this.executeAccountingOperation({
          operationId,
          transactionType:
            TRANSACTION_TYPES.REPAYMENT,
          accountingEntry,
          journal,
        });

      this.metrics.repaymentsRecorded++;

      await this.recordAudit(
        'LOAN_REPAYMENT_RECORDED',
        this.auditPayload(
          result
        )
      );

      await this.correlateSettlement(
        result
      );

      await this.triggerReconciliationHook(
        result
      );

      await this.publishEvent(
        'loan.repayment.recorded',
        result
      );

      this.serviceState.lastSuccessfulOperationAt =
        isoNow();

      this.logger.info(
        '[LOAN ACCOUNTING] Repayment recorded',
        {
          operationId,
          tenantId:
            accountingEntry.tenantId,
          loanId:
            accountingEntry.loanId,
          amount:
            accountingEntry.amount,
          reference:
            accountingEntry.reference,
          journalId:
            journal.journalId,
        }
      );

      return result;
    } catch (error) {
      this.metrics.failures++;

      this.serviceState.lastFailureAt =
        isoNow();

      await this.handleOperationFailure({
        operationId,
        transactionType:
          TRANSACTION_TYPES.REPAYMENT,
        payload,
        error,
      });

      this.logger.error(
        '[LOAN ACCOUNTING] Repayment failed',
        {
          operationId,
          error:
            error.message,
          code:
            error.code,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * RECORD LOAN DISBURSEMENT
   * ==========================================================================
   */

  async recordDisbursement(
    payload = {}
  ) {
    const operationId =
      this.resolveOperationId(
        payload,
        'disbursement'
      );

    this.serviceState.lastOperationAt =
      isoNow();

    try {
      const normalized =
        this.validateDisbursementPayload(
          payload
        );

      const existing =
        await this.findIdempotentOperation(
          normalized,
          operationId
        );

      if (existing) {
        this.metrics.idempotencyHits++;
        this.metrics.duplicateOperations++;

        await this.recordAudit(
          'LOAN_DISBURSEMENT_IDEMPOTENT_REPLAY',
          {
            tenantId:
              normalized.tenantId,

            customerId:
              normalized.customerId,

            loanId:
              normalized.loanId,

            operationId,

            reference:
              normalized.reference,
          }
        );

        return existing;
      }

      const accountingEntry =
        this.buildDisbursementEntry(
          normalized,
          operationId
        );

      const journal =
        this.buildDisbursementJournal(
          accountingEntry
        );

      this.assertImmutableJournal(
        journal
      );

      const result =
        await this.executeAccountingOperation({
          operationId,
          transactionType:
            TRANSACTION_TYPES.DISBURSEMENT,
          accountingEntry,
          journal,
        });

      this.metrics.disbursementsRecorded++;

      await this.recordAudit(
        'LOAN_DISBURSEMENT_RECORDED',
        this.auditPayload(
          result
        )
      );

      await this.correlateSettlement(
        result
      );

      await this.triggerReconciliationHook(
        result
      );

      await this.publishEvent(
        'loan.disbursement.recorded',
        result
      );

      this.serviceState.lastSuccessfulOperationAt =
        isoNow();

      this.logger.info(
        '[LOAN ACCOUNTING] Disbursement recorded',
        {
          operationId,
          tenantId:
            accountingEntry.tenantId,
          loanId:
            accountingEntry.loanId,
          amount:
            accountingEntry.amount,
          reference:
            accountingEntry.reference,
          journalId:
            journal.journalId,
        }
      );

      return result;
    } catch (error) {
      this.metrics.failures++;

      this.serviceState.lastFailureAt =
        isoNow();

      await this.handleOperationFailure({
        operationId,
        transactionType:
          TRANSACTION_TYPES.DISBURSEMENT,
        payload,
        error,
      });

      this.logger.error(
        '[LOAN ACCOUNTING] Disbursement failed',
        {
          operationId,
          error:
            error.message,
          code:
            error.code,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * EXECUTE ACCOUNTING OPERATION
   * ==========================================================================
   */

  async executeAccountingOperation({
    operationId,
    transactionType,
    accountingEntry,
    journal,
  }) {
    const operation =
      {
        operationId,
        transactionType,

        tenantId:
          accountingEntry.tenantId,

        customerId:
          accountingEntry.customerId,

        loanId:
          accountingEntry.loanId,

        reference:
          accountingEntry.reference,

        status:
          OPERATION_STATUS.CREATED,

        accountingEntry,

        journal,

        journalHash:
          this.calculateJournalHash(
            journal
          ),

        createdAt:
          isoNow(),
      };

    await this.transitionOperation(
      operation,
      OPERATION_STATUS.VALIDATING
    );

    this.validateJournalForPosting(
      journal
    );

    await this.transitionOperation(
      operation,
      OPERATION_STATUS.READY_FOR_POSTING
    );

    await this.transitionOperation(
      operation,
      OPERATION_STATUS.POSTING
    );

    const posting =
      await this.postJournal(
        journal,
        accountingEntry
      );

    operation.posting =
      clone(posting);

    operation.posted =
      Boolean(
        posting &&
        posting.posted
      );

    if (
      posting &&
      posting.success === false
    ) {
      const error =
        new Error(
          'Loan accounting journal posting failed'
        );

      error.code =
        'JOURNAL_POSTING_FAILED';

      error.posting =
        posting;

      throw error;
    }

    await this.transitionOperation(
      operation,
      OPERATION_STATUS.POSTED
    );

    operation.recordedAt =
      isoNow();

    const result =
      freezeDeep(
        clone(operation)
      );

    await this.persistOperation(
      result
    );

    return result;
  }

  /**
   * ==========================================================================
   * REPAYMENT VALIDATION
   * ==========================================================================
   */

  validateRepaymentPayload(
    payload
  ) {
    try {
      if (!isObject(payload)) {
        throw this.validationError(
          'payload must be an object'
        );
      }

      this.requireField(
        payload.loanId,
        'loanId'
      );

      this.validateTenant(
        payload
      );

      if (
        this.config.requireCustomerId
      ) {
        this.requireField(
          payload.customerId ||
            payload.memberId,
          'customerId'
        );
      }

      const amount =
        positiveAmount(
          payload.amount,
          'amount'
        );

      this.validateMaximumAmount(
        amount
      );

      const principalAmount =
        nonNegativeAmount(
          payload.principalAmount ??
            0,
          'principalAmount'
        );

      const interestAmount =
        nonNegativeAmount(
          payload.interestAmount ??
            0,
          'interestAmount'
        );

      const penaltyAmount =
        nonNegativeAmount(
          payload.penaltyAmount ??
            0,
          'penaltyAmount'
        );

      const componentTotal =
        principalAmount +
        interestAmount +
        penaltyAmount;

      if (
        componentTotal > 0 &&
        Math.abs(
          componentTotal -
            amount
        ) >
          this.config
            .principalTolerance
      ) {
        throw this.validationError(
          'principalAmount + interestAmount + penaltyAmount must equal amount'
        );
      }

      const normalized =
        {
          ...clone(payload),

          amount,

          principalAmount,

          interestAmount,

          penaltyAmount,

          tenantId:
            payload.tenantId ||
            null,

          customerId:
            payload.customerId ||
            payload.memberId ||
            null,

          memberId:
            payload.memberId ||
            null,

          accountId:
            payload.accountId ||
            null,

          loanAccountId:
            payload.loanAccountId ||
            null,

          loanPrincipalAccountId:
            payload.loanPrincipalAccountId ||
            null,

          interestIncomeAccountId:
            payload.interestIncomeAccountId ||
            null,

          penaltyIncomeAccountId:
            payload.penaltyIncomeAccountId ||
            null,

          settlementAccountId:
            payload.settlementAccountId ||
            null,

          provider:
            payload.provider ||
            this.config.defaultProvider,

          currency:
            payload.currency ||
            this.config.currency,

          reference:
            payload.reference ||
            crypto.randomUUID(),

          metadata:
            isObject(
              payload.metadata
            )
              ? clone(
                  payload.metadata
                )
              : {},
        };

      this.validateAccountMapping(
        normalized,
        TRANSACTION_TYPES.REPAYMENT
      );

      return normalized;
    } catch (error) {
      this.metrics.validationFailures++;
      throw error;
    }
  }

  /**
   * ==========================================================================
   * DISBURSEMENT VALIDATION
   * ==========================================================================
   */

  validateDisbursementPayload(
    payload
  ) {
    try {
      if (!isObject(payload)) {
        throw this.validationError(
          'payload must be an object'
        );
      }

      this.requireField(
        payload.loanId,
        'loanId'
      );

      this.validateTenant(
        payload
      );

      if (
        this.config.requireCustomerId
      ) {
        this.requireField(
          payload.customerId ||
            payload.memberId,
          'customerId'
        );
      }

      const amount =
        positiveAmount(
          payload.amount,
          'amount'
        );

      this.validateMaximumAmount(
        amount
      );

      const normalized =
        {
          ...clone(payload),

          amount,

          tenantId:
            payload.tenantId ||
            null,

          customerId:
            payload.customerId ||
            payload.memberId ||
            null,

          memberId:
            payload.memberId ||
            null,

          provider:
            payload.provider ||
            this.config.defaultProvider,

          currency:
            payload.currency ||
            this.config.currency,

          reference:
            payload.reference ||
            crypto.randomUUID(),

          loanAccountId:
            payload.loanAccountId ||
            null,

          settlementAccountId:
            payload.settlementAccountId ||
            null,

          metadata:
            isObject(
              payload.metadata
            )
              ? clone(
                  payload.metadata
                )
              : {},
        };

      this.validateAccountMapping(
        normalized,
        TRANSACTION_TYPES.DISBURSEMENT
      );

      return normalized;
    } catch (error) {
      this.metrics.validationFailures++;
      throw error;
    }
  }

  /**
   * ==========================================================================
   * TENANT ISOLATION
   * ==========================================================================
   */

  validateTenant(payload) {
    if (
      this.config.requireTenantId &&
      !payload.tenantId
    ) {
      throw this.validationError(
        'tenantId is required'
      );
    }

    if (
      payload.tenantId !== undefined &&
      payload.tenantId !== null &&
      typeof payload.tenantId !==
        'string'
    ) {
      throw this.validationError(
        'tenantId must be a string'
      );
    }
  }

  /**
   * ==========================================================================
   * ACCOUNT MAPPING
   * ==========================================================================
   */

  validateAccountMapping(
    payload,
    transactionType
  ) {
    if (
      !this.config
        .requireAccountMapping
    ) {
      return true;
    }

    if (
      transactionType ===
      TRANSACTION_TYPES.REPAYMENT
    ) {
      if (
        !payload.settlementAccountId &&
        !payload.accountId
      ) {
        throw this.validationError(
          'settlementAccountId or accountId is required for repayment posting'
        );
      }

      if (
        payload.principalAmount > 0 &&
        !payload.loanPrincipalAccountId &&
        !payload.loanAccountId
      ) {
        throw this.validationError(
          'loanPrincipalAccountId or loanAccountId is required for principal repayment'
        );
      }
    }

    if (
      transactionType ===
      TRANSACTION_TYPES.DISBURSEMENT
    ) {
      if (
        !payload.loanAccountId
      ) {
        throw this.validationError(
          'loanAccountId is required for disbursement posting'
        );
      }

      if (
        !payload.settlementAccountId
      ) {
        throw this.validationError(
          'settlementAccountId is required for disbursement posting'
        );
      }
    }

    return true;
  }

  /**
   * ==========================================================================
   * BUILD REPAYMENT ACCOUNTING ENTRY
   * ==========================================================================
   */

  buildRepaymentEntry(
    payload,
    operationId
  ) {
    const entry =
      {
        entryId:
          crypto.randomUUID(),

        operationId,

        transactionType:
          TRANSACTION_TYPES.REPAYMENT,

        provider:
          payload.provider,

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

        repaymentId:
          payload.repaymentId ||
          null,

        reference:
          payload.reference,

        amount:
          payload.amount,

        principalAmount:
          payload.principalAmount,

        interestAmount:
          payload.interestAmount,

        penaltyAmount:
          payload.penaltyAmount,

        currency:
          payload.currency,

        loanAccountId:
          payload.loanAccountId,

        loanPrincipalAccountId:
          payload.loanPrincipalAccountId,

        interestIncomeAccountId:
          payload.interestIncomeAccountId,

        penaltyIncomeAccountId:
          payload.penaltyIncomeAccountId,

        settlementAccountId:
          payload.settlementAccountId,

        repaymentDate:
          payload.repaymentDate ||
          isoNow(),

        metadata:
          clone(
            payload.metadata
          ),

        createdAt:
          isoNow(),
      };

    return this.config
      .immutableJournalPayloads
      ? freezeDeep(entry)
      : Object.freeze(entry);
  }

  /**
   * ==========================================================================
   * BUILD DISBURSEMENT ACCOUNTING ENTRY
   * ==========================================================================
   */

  buildDisbursementEntry(
    payload,
    operationId
  ) {
    const entry =
      {
        entryId:
          crypto.randomUUID(),

        operationId,

        transactionType:
          TRANSACTION_TYPES.DISBURSEMENT,

        provider:
          payload.provider,

        tenantId:
          payload.tenantId,

        customerId:
          payload.customerId,

        memberId:
          payload.memberId,

        loanId:
          payload.loanId,

        reference:
          payload.reference,

        amount:
          payload.amount,

        currency:
          payload.currency,

        loanAccountId:
          payload.loanAccountId,

        settlementAccountId:
          payload.settlementAccountId,

        disbursementDate:
          payload.disbursementDate ||
          isoNow(),

        metadata:
          clone(
            payload.metadata
          ),

        createdAt:
          isoNow(),
      };

    return this.config
      .immutableJournalPayloads
      ? freezeDeep(entry)
      : Object.freeze(entry);
  }

  /**
   * ==========================================================================
   * BUILD REPAYMENT JOURNAL
   * ==========================================================================
   *
   * Default:
   *
   * DEBIT:
   *   Cash / Settlement
   *
   * CREDIT:
   *   Loan Principal Receivable
   *   Interest Income
   *   Penalty Income
   *
   * ==========================================================================
   */

  buildRepaymentJournal(
    entry
  ) {
    const creditLines = [];

    if (
      entry.principalAmount > 0
    ) {
      creditLines.push({
        type:
          ENTRY_TYPES.CREDIT,

        component:
          'PRINCIPAL',

        amount:
          entry.principalAmount,

        accountId:
          entry.loanPrincipalAccountId ||
          entry.loanAccountId ||
          null,
      });
    }

    if (
      entry.interestAmount > 0
    ) {
      creditLines.push({
        type:
          ENTRY_TYPES.CREDIT,

        component:
          'INTEREST',

        amount:
          entry.interestAmount,

        accountId:
          entry.interestIncomeAccountId ||
          null,
      });
    }

    if (
      entry.penaltyAmount > 0
    ) {
      creditLines.push({
        type:
          ENTRY_TYPES.CREDIT,

        component:
          'PENALTY',

        amount:
          entry.penaltyAmount,

        accountId:
          entry.penaltyIncomeAccountId ||
          null,
      });
    }

    if (
      creditLines.length === 0
    ) {
      creditLines.push({
        type:
          ENTRY_TYPES.CREDIT,

        component:
          'LOAN_RECEIVABLE',

        amount:
          entry.amount,

        accountId:
          entry.loanAccountId ||
          null,
      });
    }

    const journal =
      {
        journalId:
          crypto.randomUUID(),

        operationId:
          entry.operationId,

        transactionType:
          entry.transactionType,

        tenantId:
          entry.tenantId,

        customerId:
          entry.customerId,

        loanId:
          entry.loanId,

        currency:
          entry.currency,

        reference:
          entry.reference,

        entries: [
          {
            type:
              ENTRY_TYPES.DEBIT,

            component:
              'CASH_OR_SETTLEMENT',

            amount:
              entry.amount,

            accountId:
              entry.settlementAccountId ||
              entry.accountId ||
              null,
          },

          ...creditLines,
        ],

        metadata: {
          source:
            SERVICE_NAME,

          provider:
            entry.provider,

          operationId:
            entry.operationId,

          reference:
            entry.reference,
        },

        createdAt:
          isoNow(),
      };

    const totals =
      this.calculateJournalTotals(
        journal
      );

    this.assertBalancedJournal(
      totals.debitTotal,
      totals.creditTotal
    );

    return this.freezeJournal(
      journal
    );
  }

  /**
   * ==========================================================================
   * BUILD DISBURSEMENT JOURNAL
   * ==========================================================================
   *
   * DEBIT:
   *   Loan Receivable
   *
   * CREDIT:
   *   Cash / Settlement
   *
   * ==========================================================================
   */

  buildDisbursementJournal(
    entry
  ) {
    const journal =
      {
        journalId:
          crypto.randomUUID(),

        operationId:
          entry.operationId,

        transactionType:
          entry.transactionType,

        tenantId:
          entry.tenantId,

        customerId:
          entry.customerId,

        loanId:
          entry.loanId,

        currency:
          entry.currency,

        reference:
          entry.reference,

        entries: [
          {
            type:
              ENTRY_TYPES.DEBIT,

            component:
              'LOAN_RECEIVABLE',

            amount:
              entry.amount,

            accountId:
              entry.loanAccountId ||
              null,
          },

          {
            type:
              ENTRY_TYPES.CREDIT,

            component:
              'CASH_OR_SETTLEMENT',

            amount:
              entry.amount,

            accountId:
              entry.settlementAccountId ||
              null,
          },
        ],

        metadata: {
          source:
            SERVICE_NAME,

          provider:
            entry.provider,

          operationId:
            entry.operationId,

          reference:
            entry.reference,
        },

        createdAt:
          isoNow(),
      };

    const totals =
      this.calculateJournalTotals(
        journal
      );

    this.assertBalancedJournal(
      totals.debitTotal,
      totals.creditTotal
    );

    return this.freezeJournal(
      journal
    );
  }

  /**
   * ==========================================================================
   * FREEZE JOURNAL
   * ==========================================================================
   */

  freezeJournal(
    journal
  ) {
    const immutable =
      freezeDeep(
        clone(journal)
      );

    const journalHash =
      this.calculateJournalHash(
        immutable
      );

    Object.defineProperty(
      immutable,
      'journalHash',
      {
        value:
          journalHash,

        enumerable:
          true,

        writable:
          false,

        configurable:
          false,
      }
    );

    return immutable;
  }

  /**
   * ==========================================================================
   * JOURNAL HASH
   * ==========================================================================
   */

  calculateJournalHash(
    journal
  ) {
    const canonical =
      {
        journalId:
          journal.journalId,

        operationId:
          journal.operationId,

        transactionType:
          journal.transactionType,

        tenantId:
          journal.tenantId,

        reference:
          journal.reference,

        currency:
          journal.currency,

        entries:
          journal.entries,

        metadata:
          journal.metadata,
      };

    return sha256(
      canonical
    );
  }

  /**
   * ==========================================================================
   * JOURNAL VALIDATION
   * ==========================================================================
   */

  validateJournalForPosting(
    journal
  ) {
    if (!journal) {
      throw this.validationError(
        'journal is required'
      );
    }

    if (
      !journal.journalId
    ) {
      throw this.validationError(
        'journalId is required'
      );
    }

    if (
      !journal.operationId
    ) {
      throw this.validationError(
        'operationId is required'
      );
    }

    if (
      !journal.reference
    ) {
      throw this.validationError(
        'journal reference is required'
      );
    }

    if (
      !Array.isArray(
        journal.entries
      ) ||
      journal.entries.length < 2
    ) {
      throw this.validationError(
        'journal must contain at least two entries'
      );
    }

    let debitTotal = 0;
    let creditTotal = 0;

    for (
      const line of journal.entries
    ) {
      if (
        !line ||
        !Object.values(
          ENTRY_TYPES
        ).includes(
          line.type
        )
      ) {
        throw this.validationError(
          'journal contains an invalid entry type'
        );
      }

      if (
        !Number.isFinite(
          Number(line.amount)
        ) ||
        Number(line.amount) <= 0
      ) {
        throw this.validationError(
          'journal entry amounts must be greater than zero'
        );
      }

      if (
        line.type ===
        ENTRY_TYPES.DEBIT
      ) {
        debitTotal +=
          Number(line.amount);
      } else {
        creditTotal +=
          Number(line.amount);
      }
    }

    this.assertBalancedJournal(
      debitTotal,
      creditTotal
    );

    return true;
  }

  /**
   * ==========================================================================
   * JOURNAL TOTALS
   * ==========================================================================
   */

  calculateJournalTotals(
    journal
  ) {
    return journal.entries.reduce(
      (totals, entry) => {
        if (
          entry.type ===
          ENTRY_TYPES.DEBIT
        ) {
          totals.debitTotal +=
            Number(entry.amount);
        }

        if (
          entry.type ===
          ENTRY_TYPES.CREDIT
        ) {
          totals.creditTotal +=
            Number(entry.amount);
        }

        return totals;
      },
      {
        debitTotal: 0,
        creditTotal: 0,
      }
    );
  }

  /**
   * ==========================================================================
   * POSTING ENGINE INTEGRATION
   * ==========================================================================
   *
   * Preference:
   *
   *   1. postingEngine.post()
   *   2. ledgerService.post()
   *   3. ledgerService.postJournal()
   *   4. journalService.create()
   *   5. journalService.createJournal()
   *
   * Compatibility mode never claims that the ledger was posted.
   * ==========================================================================
   */

  async postJournal(
    journal,
    accountingEntry
  ) {
    this.metrics
      .journalPostingsAttempted++;

    try {
      this.validateJournalForPosting(
        journal
      );

      let result;

      if (
        this.postingEngine &&
        typeof this.postingEngine.post ===
          'function'
      ) {
        result =
          await this.postingEngine.post(
            journal
          );
      } else if (
        this.ledgerService &&
        typeof this.ledgerService.post ===
          'function'
      ) {
        result =
          await this.ledgerService.post(
            journal
          );
      } else if (
        this.ledgerService &&
        typeof this.ledgerService.postJournal ===
          'function'
      ) {
        result =
          await this.ledgerService.postJournal(
            journal
          );
      } else if (
        this.journalService &&
        typeof this.journalService.create ===
          'function'
      ) {
        result =
          await this.journalService.create(
            journal
          );
      } else if (
        this.journalService &&
        typeof this.journalService.createJournal ===
          'function'
      ) {
        result =
          await this.journalService.createJournal(
            journal
          );
      } else {
        if (
          this.config
            .failWithoutLedger
        ) {
          const error =
            new Error(
              'No Ledger/Posting Engine dependency configured'
            );

          error.code =
            'LEDGER_ENGINE_UNAVAILABLE';

          throw error;
        }

        result = {
          success: true,

          journalId:
            journal.journalId,

          posted: false,

          mode:
            'compatibility-hook',

          warning:
            'No Ledger/Posting Engine dependency was configured.',
        };
      }

      this.metrics
        .journalPostingsSucceeded++;

      this.metrics
        .journalEntriesCreated++;

      return {
        ...clone(result),

        journalId:
          result?.journalId ||
          journal.journalId,

        operationId:
          journal.operationId,

        reference:
          journal.reference,

        transactionType:
          journal.transactionType,

        posted:
          Boolean(
            result?.posted
          ),

        postingTimestamp:
          isoNow(),
      };
    } catch (error) {
      this.metrics
        .journalPostingsFailed++;

      throw error;
    }
  }

  /**
   * ==========================================================================
   * LEGACY JOURNAL ENTRY HOOK
   * ==========================================================================
   *
   * Existing callers can continue calling:
   *
   *   createJournalEntry(entry)
   *
   * ==========================================================================
   */

  async createJournalEntry(
    entry
  ) {
    if (!entry) {
      throw new Error(
        'Accounting entry is required'
      );
    }

    const journal =
      entry.transactionType ===
      TRANSACTION_TYPES.DISBURSEMENT
        ? this.buildDisbursementJournal(
            entry
          )
        : this.buildRepaymentJournal(
            entry
          );

    return this.postJournal(
      journal,
      entry
    );
  }

  /**
   * ==========================================================================
   * IDEMPOTENCY
   * ==========================================================================
   */

  resolveOperationId(
    payload,
    type
  ) {
    return (
      payload.idempotencyKey ||
      payload.operationId ||
      payload.reference ||
      `${type}:${payload.loanId || 'unknown'}:${crypto.randomUUID()}`
    );
  }

  async findIdempotentOperation(
    payload,
    operationId
  ) {
    if (
      !this.config
        .enableIdempotency
    ) {
      return null;
    }

    const tenantId =
      payload.tenantId ||
      null;

    /**
     * Database adapter.
     */

    if (
      this.db &&
      this.db.accountingOperations &&
      typeof this.db
        .accountingOperations.findOne ===
        'function'
    ) {
      return this.db
        .accountingOperations.findOne({
          operationId,
          tenantId,
        });
    }

    /**
     * Cache fallback.
     */

    if (
      this.cache &&
      typeof this.cache.get ===
        'function'
    ) {
      const key =
        this.idempotencyKey(
          tenantId,
          operationId
        );

      return this.cache.get(
        key
      );
    }

    return null;
  }

  idempotencyKey(
    tenantId,
    operationId
  ) {
    return (
      `loan-accounting:idempotency:` +
      `${tenantId || 'global'}:` +
      `${operationId}`
    );
  }

  async persistOperation(
    result
  ) {
    const immutable =
      clone(result);

    /**
     * Database persistence.
     */

    if (
      this.db &&
      this.db.accountingOperations &&
      typeof this.db
        .accountingOperations.create ===
        'function'
    ) {
      try {
        await this.db
          .accountingOperations.create(
            immutable
          );

        return;
      } catch (error) {
        /**
         * Duplicate persistence is treated as an idempotency race.
         *
         * Re-read the operation before failing.
         */

        if (
          this.isDuplicateError(
            error
          )
        ) {
          const existing =
            await this.findIdempotentOperation(
              result.accountingEntry,
              result.operationId
            );

          if (existing) {
            return;
          }
        }

        throw error;
      }
    }

    /**
     * Cache fallback.
     */

    if (
      this.cache &&
      typeof this.cache.set ===
        'function'
    ) {
      const key =
        this.idempotencyKey(
          result.accountingEntry
            .tenantId,
          result.operationId
        );

      await this.cache.set(
        key,
        immutable,
        this.config
          .idempotencyTtl
      );
    }
  }

  isDuplicateError(
    error
  ) {
    const code =
      error?.code;

    return (
      code === 11000 ||
      code ===
        'DUPLICATE_KEY' ||
      code ===
        'ALREADY_EXISTS'
    );
  }

  /**
   * ==========================================================================
   * OPERATION STATE MACHINE
   * ==========================================================================
   */

  async transitionOperation(
    operation,
    nextStatus
  ) {
    const current =
      operation.status;

    if (
      current === nextStatus
    ) {
      return operation;
    }

    if (
      !this.isValidTransition(
        current,
        nextStatus
      )
    ) {
      const error =
        new Error(
          `Invalid accounting operation transition: ${current} -> ${nextStatus}`
        );

      error.code =
        'INVALID_ACCOUNTING_STATE_TRANSITION';

      throw error;
    }

    operation.status =
      nextStatus;

    operation.updatedAt =
      isoNow();

    this.metrics
      .stateTransitions++;

    return operation;
  }

  isValidTransition(
    current,
    next
  ) {
    const transitions = {
      [OPERATION_STATUS.CREATED]:
        [
          OPERATION_STATUS.VALIDATING,
          OPERATION_STATUS.FAILED,
        ],

      [OPERATION_STATUS.VALIDATING]:
        [
          OPERATION_STATUS.READY_FOR_POSTING,
          OPERATION_STATUS.FAILED,
        ],

      [OPERATION_STATUS.READY_FOR_POSTING]:
        [
          OPERATION_STATUS.POSTING,
          OPERATION_STATUS.FAILED,
        ],

      [OPERATION_STATUS.POSTING]:
        [
          OPERATION_STATUS.POSTED,
          OPERATION_STATUS.FAILED,
          OPERATION_STATUS.RETRY_PENDING,
        ],

      [OPERATION_STATUS.POSTED]:
        [
          OPERATION_STATUS.SETTLED,
          OPERATION_STATUS.RECONCILED,
          OPERATION_STATUS.REVERSED,
        ],

      [OPERATION_STATUS.SETTLED]:
        [
          OPERATION_STATUS.RECONCILED,
          OPERATION_STATUS.REVERSED,
        ],

      [OPERATION_STATUS.RECONCILED]:
        [
          OPERATION_STATUS.REVERSED,
        ],

      [OPERATION_STATUS.FAILED]:
        [
          OPERATION_STATUS.RETRY_PENDING,
          OPERATION_STATUS.DEAD_LETTERED,
        ],

      [OPERATION_STATUS.RETRY_PENDING]:
        [
          OPERATION_STATUS.POSTING,
          OPERATION_STATUS.DEAD_LETTERED,
        ],

      [OPERATION_STATUS.DEAD_LETTERED]:
        [],

      [OPERATION_STATUS.REVERSED]:
        [],
    };

    return (
      transitions[current] ||
      []
    ).includes(next);
  }

  /**
   * ==========================================================================
   * REVERSAL SUPPORT
   * ==========================================================================
   *
   * Financial records are never edited.
   *
   * A reversal creates a NEW balanced journal that references the original
   * operation.
   * ==========================================================================
   */

  async reverseOperation({
    tenantId = null,
    operationId,
    reason,
    reversedBy,
    reference,
    metadata = {},
  } = {}) {
    if (
      !this.config.enableReversal
    ) {
      throw this.validationError(
        'Accounting reversals are disabled'
      );
    }

    this.requireField(
      operationId,
      'operationId'
    );

    this.requireField(
      reason,
      'reason'
    );

    const original =
      await this.findOperationById(
        tenantId,
        operationId
      );

    if (!original) {
      const error =
        new Error(
          'Accounting operation not found'
        );

      error.code =
        'ACCOUNTING_OPERATION_NOT_FOUND';

      throw error;
    }

    if (
      original.status ===
      OPERATION_STATUS.REVERSED
    ) {
      return original;
    }

    if (
      ![
        OPERATION_STATUS.POSTED,
        OPERATION_STATUS.SETTLED,
        OPERATION_STATUS.RECONCILED,
      ].includes(
        original.status
      )
    ) {
      const error =
        new Error(
          `Operation cannot be reversed from state ${original.status}`
        );

      error.code =
        'INVALID_REVERSAL_STATE';

      throw error;
    }

    const reversalOperationId =
      crypto.randomUUID();

    const reversalReference =
      reference ||
      `REV-${original.reference}-${crypto.randomUUID()}`;

    const reversalJournal =
      this.buildReversalJournal(
        original,
        {
          reversalOperationId,
          reversalReference,
          reason,
          reversedBy,
          metadata,
        }
      );

    const posting =
      await this.postJournal(
        reversalJournal,
        {
          operationId:
            reversalOperationId,

          transactionType:
            TRANSACTION_TYPES.REVERSAL,

          tenantId,

          loanId:
            original.loanId,

          reference:
            reversalReference,
        }
      );

    const result =
      freezeDeep({
        success: true,

        operationId:
          reversalOperationId,

        originalOperationId:
          operationId,

        transactionType:
          TRANSACTION_TYPES.REVERSAL,

        status:
          OPERATION_STATUS.REVERSED,

        journal:
          clone(
            reversalJournal
          ),

        posting:
          clone(posting),

        reason,

        reversedBy:
          reversedBy || null,

        createdAt:
          isoNow(),
      });

    await this.persistOperation(
      result
    );

    this.metrics
      .reversalsCreated++;

    await this.recordAudit(
      'LOAN_ACCOUNTING_REVERSED',
      {
        tenantId,

        operationId:
          reversalOperationId,

        originalOperationId:
          operationId,

        loanId:
          original.loanId,

        reason,

        reversedBy:
          reversedBy || null,
      }
    );

    await this.publishEvent(
      'loan.accounting.reversed',
      result
    );

    return result;
  }

  async findOperationById(
    tenantId,
    operationId
  ) {
    if (
      this.db &&
      this.db.accountingOperations &&
      typeof this.db
        .accountingOperations.findOne ===
        'function'
    ) {
      return this.db
        .accountingOperations.findOne({
          operationId,
          tenantId:
            tenantId || null,
        });
    }

    if (
      this.cache &&
      typeof this.cache.get ===
        'function'
    ) {
      return this.cache.get(
        this.idempotencyKey(
          tenantId,
          operationId
        )
      );
    }

    return null;
  }

  buildReversalJournal(
    original,
    reversal
  ) {
    const originalEntries =
      original.journal?.entries ||
      [];

    if (
      originalEntries.length < 2
    ) {
      throw new Error(
        'Original journal cannot be reversed because it contains insufficient entries'
      );
    }

    const entries =
      originalEntries.map(
        (line) => ({
          ...clone(line),

          type:
            line.type ===
            ENTRY_TYPES.DEBIT
              ? ENTRY_TYPES.CREDIT
              : ENTRY_TYPES.DEBIT,
        })
      );

    const journal =
      {
        journalId:
          crypto.randomUUID(),

        operationId:
          reversal.reversalOperationId,

        transactionType:
          TRANSACTION_TYPES.REVERSAL,

        tenantId:
          original.tenantId,

        customerId:
          original.customerId,

        loanId:
          original.loanId,

        currency:
          original.journal.currency,

        reference:
          reversal.reversalReference,

        reversalOf:
          original.journal.journalId,

        reversalOfOperationId:
          original.operationId,

        entries,

        metadata: {
          ...clone(
            reversal.metadata
          ),

          reversalReason:
            reversal.reason,

          reversedBy:
            reversal.reversedBy ||
            null,
        },

        createdAt:
          isoNow(),
      };

    const totals =
      this.calculateJournalTotals(
        journal
      );

    this.assertBalancedJournal(
      totals.debitTotal,
      totals.creditTotal
    );

    return this.freezeJournal(
      journal
    );
  }

  /**
   * ==========================================================================
   * SETTLEMENT CORRELATION
   * ==========================================================================
   */

  async correlateSettlement(
    result
  ) {
    if (
      !this.config
        .enableSettlementCorrelation
    ) {
      return null;
    }

    if (
      !this.settlementService
    ) {
      return null;
    }

    const entry =
      result.accountingEntry;

    try {
      let settlementResult;

      if (
        typeof this
          .settlementService
          .recordSettlement ===
        'function'
      ) {
        settlementResult =
          await this
            .settlementService
            .recordSettlement({
              tenantId:
                entry.tenantId,

              reference:
                entry.reference,

              provider:
                entry.provider,

              transactionId:
                entry.operationId,

              transactionType:
                entry.transactionType,

              amount:
                entry.amount,

              currency:
                entry.currency,

              metadata: {
                loanId:
                  entry.loanId,

                operationId:
                  entry.operationId,

                accountingJournalId:
                  result.journal
                    .journalId,
              },
            });
      }

      if (
        settlementResult
      ) {
        this.metrics
          .settlementsCorrelated++;
      }

      return settlementResult;
    } catch (error) {
      await this.recordAudit(
        'SETTLEMENT_CORRELATION_FAILED',
        {
          tenantId:
            entry.tenantId,

          loanId:
            entry.loanId,

          operationId:
            result.operationId,

          error:
            error.message,
        }
      );

      this.logger.error(
        '[LOAN ACCOUNTING] Settlement correlation failed',
        {
          operationId:
            result.operationId,

          error:
            error.message,
        }
      );

      return null;
    }
  }

  /**
   * ==========================================================================
   * RECONCILIATION HOOK
   * ==========================================================================
   */

  async triggerReconciliationHook(
    result
  ) {
    if (
      !this.config
        .enableReconciliationHooks
    ) {
      return null;
    }

    if (
      !this.reconciliationService
    ) {
      return null;
    }

    try {
      this.metrics
        .reconciliationHooksTriggered++;

      if (
        typeof this
          .reconciliationService
          .queue ===
        'function'
      ) {
        return this
          .reconciliationService
          .queue({
            provider:
              result.accountingEntry
                .provider,

            tenantId:
              result.accountingEntry
                .tenantId,

            reference:
              result.accountingEntry
                .reference,

            operationId:
              result.operationId,
          });
      }

      if (
        typeof this
          .reconciliationService
          .reconcileTransaction ===
        'function'
      ) {
        return this
          .reconciliationService
          .reconcileTransaction({
            tenantId:
              result.accountingEntry
                .tenantId,

            reference:
              result.accountingEntry
                .reference,

            operationId:
              result.operationId,
          });
      }

      return null;
    } catch (error) {
      await this.recordAudit(
        'RECONCILIATION_HOOK_FAILED',
        {
          tenantId:
            result.accountingEntry
              .tenantId,

          operationId:
            result.operationId,

          error:
            error.message,
        }
      );

      return null;
    }
  }

  /**
   * ==========================================================================
   * RETRY / DLQ
   * ==========================================================================
   */

  async handleOperationFailure({
    operationId,
    transactionType,
    payload,
    error,
  }) {
    if (
      !this.config
        .enableRetryHooks
    ) {
      return null;
    }

    const attempt =
      Number(
        payload.retryAttempt || 0
      );

    if (
      attempt <
      this.config.maxRetryAttempts
    ) {
      return this.queueRetry({
        operationId,
        transactionType,
        payload,
        error,
        attempt:
          attempt + 1,
      });
    }

    return this.queueDeadLetter({
      operationId,
      transactionType,
      payload,
      error,
      attempt,
    });
  }

  async queueRetry({
    operationId,
    transactionType,
    payload,
    error,
    attempt,
  }) {
    this.metrics
      .retriesQueued++;

    const retryPayload =
      {
        operationId,

        transactionType,

        tenantId:
          payload.tenantId ||
          null,

        loanId:
          payload.loanId ||
          null,

        attempt,

        error:
          error?.message,

        scheduledAt:
          new Date(
            Date.now() +
              this.config
                .retryBaseDelayMs *
                Math.pow(
                  2,
                  attempt - 1
                )
          ).toISOString(),
      };

    if (
      this.queueService &&
      typeof this
        .queueService.enqueue ===
        'function'
    ) {
      await this.queueService.enqueue(
        'loan-accounting-retry',
        retryPayload
      );
    }

    await this.recordAudit(
      'LOAN_ACCOUNTING_RETRY_QUEUED',
      retryPayload
    );

    return retryPayload;
  }

  async queueDeadLetter({
    operationId,
    transactionType,
    payload,
    error,
    attempt,
  }) {
    this.metrics
      .deadLettersQueued++;

    const deadLetter =
      {
        operationId,

        transactionType,

        tenantId:
          payload.tenantId ||
          null,

        loanId:
          payload.loanId ||
          null,

        attempt,

        error:
          error?.message,

        failedAt:
          isoNow(),
      };

    if (
      this.queueService &&
      typeof this
        .queueService.enqueue ===
        'function'
    ) {
      await this.queueService.enqueue(
        'loan-accounting-dlq',
        deadLetter
      );
    }

    await this.recordAudit(
      'LOAN_ACCOUNTING_DEAD_LETTERED',
      deadLetter
    );

    return deadLetter;
  }

  /**
   * ==========================================================================
   * AUDIT
   * ==========================================================================
   */

  auditPayload(
    result
  ) {
    const entry =
      result.accountingEntry;

    return {
      tenantId:
        entry.tenantId,

      customerId:
        entry.customerId,

      loanId:
        entry.loanId,

      operationId:
        result.operationId,

      reference:
        entry.reference,

      amount:
        entry.amount,

      currency:
        entry.currency,

      transactionType:
        entry.transactionType,

      journalId:
        result.journal.journalId,

      journalHash:
        result.journalHash ||
        this.calculateJournalHash(
          result.journal
        ),
    };
  }

  async recordAudit(
    event,
    payload = {}
  ) {
    this.metrics.auditEvents++;

    const safePayload =
      this.config
        .redactSensitiveAuditData
        ? this.sanitizeAuditPayload(
            payload
          )
        : clone(payload);

    const tenantId =
      payload.tenantId ||
      null;

    const customerId =
      payload.customerId ||
      null;

    if (
      this.auditService &&
      typeof this.auditService.log ===
        'function'
    ) {
      try {
        await this.auditService.log({
          tenantId,

          customerId,

          service:
            this.serviceName,

          action:
            event,

          payload:
            safePayload,

          timestamp:
            now(),
        });

        return true;
      } catch (error) {
        this.logger.error(
          '[LOAN ACCOUNTING AUDIT] Audit failed',
          {
            event,
            error:
              error.message,
          }
        );
      }
    }

    this.logger.info(
      '[LOAN ACCOUNTING AUDIT]',
      {
        event,

        payload:
          safePayload,

        timestamp:
          isoNow(),
      }
    );

    return true;
  }

  sanitizeAuditPayload(
    payload
  ) {
    const result =
      clone(payload) || {};

    const sensitiveFields = [
      'phoneNumber',
      'idNumber',
      'nationalId',
      'documentNumber',
      'apiKey',
      'accessToken',
      'token',
      'password',
      'secret',
    ];

    for (
      const field of sensitiveFields
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          result,
          field
        )
      ) {
        result[field] =
          '[REDACTED]';
      }
    }

    return result;
  }

  /**
   * ==========================================================================
   * EVENT PUBLISHING
   * ==========================================================================
   */

  async publishEvent(
    eventName,
    payload
  ) {
    if (
      !this.config.emitEvents
    ) {
      return;
    }

    this.emit(
      eventName,
      payload
    );

    if (
      !this.eventBus
    ) {
      return;
    }

    try {
      if (
        typeof this.eventBus
          .publish ===
        'function'
      ) {
        await this.eventBus.publish(
          eventName,
          payload
        );
      } else if (
        typeof this.eventBus
          .emit ===
        'function'
      ) {
        await Promise.resolve(
          this.eventBus.emit(
            eventName,
            payload
          )
        );
      }

      this.metrics
        .eventsPublished++;
    } catch (error) {
      this.metrics
        .eventFailures++;

      this.logger.error(
        '[LOAN ACCOUNTING] Event publication failed',
        {
          eventName,
          error:
            error.message,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * JOURNAL BALANCE VALIDATION
   * ==========================================================================
   */

  assertBalancedJournal(
    debitTotal,
    creditTotal
  ) {
    const debit =
      toFiniteNumber(
        debitTotal,
        'debitTotal'
      );

    const credit =
      toFiniteNumber(
        creditTotal,
        'creditTotal'
      );

    const difference =
      Math.abs(
        debit - credit
      );

    if (
      difference >
      this.config
        .principalTolerance
    ) {
      const error =
        new Error(
          'Unbalanced journal entry'
        );

      error.code =
        'UNBALANCED_JOURNAL';

      error.details = {
        debitTotal:
          debit,

        creditTotal:
          credit,

        difference,
      };

      throw error;
    }

    return true;
  }

  /**
   * ==========================================================================
   * IMMUTABILITY VALIDATION
   * ==========================================================================
   */

  assertImmutableJournal(
    journal
  ) {
    if (
      !Object.isFrozen(
        journal
      )
    ) {
      throw this.validationError(
        'journal must be immutable before posting'
      );
    }

    if (
      !Object.isFrozen(
        journal.entries
      )
    ) {
      throw this.validationError(
        'journal entries must be immutable before posting'
      );
    }

    return true;
  }

  /**
   * ==========================================================================
   * VALIDATION ERROR
   * ==========================================================================
   */

  validationError(
    message
  ) {
    const error =
      new Error(message);

    error.code =
      'LOAN_ACCOUNTING_VALIDATION_ERROR';

    return error;
  }

  requireField(
    value,
    fieldName
  ) {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      this.metrics
        .validationFailures++;

      throw this.validationError(
        `${fieldName} is required`
      );
    }
  }

  validateMaximumAmount(
    amount
  ) {
    if (
      amount >
      this.config.maxAmount
    ) {
      throw this.validationError(
        'amount exceeds configured maximum'
      );
    }
  }

  /**
   * ==========================================================================
   * HEALTH CHECK
   * ==========================================================================
   */

  healthCheck() {
    const ledgerAvailable =
      Boolean(
        this.postingEngine ||
        this.ledgerService ||
        this.journalService
      );

    return {
      healthy:
        true,

      service:
        this.serviceName,

      ledgerIntegration:
        ledgerAvailable,

      compatibilityMode:
        !ledgerAvailable,

      idempotency:
        Boolean(
          this.config
            .enableIdempotency
        ),

      reversalSupport:
        Boolean(
          this.config
            .enableReversal
        ),

      settlementIntegration:
        Boolean(
          this.settlementService
        ),

      reconciliationIntegration:
        Boolean(
          this.reconciliationService
        ),

      retryIntegration:
        Boolean(
          this.queueService
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
    const ledger =
      Boolean(
        this.postingEngine ||
        this.ledgerService ||
        this.journalService
      );

    const dependencies =
      {
        database:
          Boolean(this.db),

        ledger,

        audit:
          Boolean(
            this.auditService
          ),

        cache:
          Boolean(this.cache),

        settlement:
          Boolean(
            this.settlementService
          ),

        reconciliation:
          Boolean(
            this.reconciliationService
          ),

        queue:
          Boolean(
            this.queueService
          ),
      };

    const ready =
      Boolean(
        dependencies.database &&
        ledger
      );

    return {
      ready,

      service:
        this.serviceName,

      dependencies,

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
        this.serviceName,

      ...clone(
        this.metrics
      ),

      state:
        {
          ...this.serviceState,
        },

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
        typeof this
          .metricsService
          .record ===
        'function'
      ) {
        await this.metricsService.record(
          'loan_accounting',
          metrics
        );
      } else if (
        typeof this
          .metricsService
          .increment ===
        'function'
      ) {
        await this.metricsService.increment(
          'loan_accounting_operations'
        );
      }
    } catch (error) {
      this.logger.warn(
        '[LOAN ACCOUNTING] Metrics publication failed',
        {
          error:
            error.message,
        }
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
      this.createMetrics();

    this.serviceState = {
      startedAt:
        isoNow(),

      lastOperationAt:
        null,

      lastSuccessfulOperationAt:
        null,

      lastFailureAt:
        null,
    };
  }
}

/**
 * ============================================================================
 * SINGLETON COMPATIBILITY
 * ============================================================================
 *
 * Existing callers:
 *
 *   const loanAccountingService =
 *     require('./loanAccountingService');
 *
 *   await loanAccountingService.recordRepayment(...);
 *
 * Optional dependency injection:
 *
 *   loanAccountingService.configure({
 *     db,
 *     ledgerService,
 *     journalService,
 *     postingEngine,
 *     auditService,
 *     eventBus,
 *     cache,
 *     metricsService,
 *     settlementService,
 *     reconciliationService,
 *     queueService
 *   });
 *
 * ============================================================================
 */

module.exports =
  new LoanAccountingService();