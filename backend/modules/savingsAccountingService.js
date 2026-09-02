'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Savings Accounting Service
 * ============================================================================
 *
 * File:
 *   backend/modules/savingsAccountingService.js
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Savings deposit accounting orchestration
 * - Savings contribution accounting orchestration
 * - Journal creation
 * - Ledger posting integration
 * - Accounting idempotency
 * - Provider transaction integration
 * - Mobile-money settlement metadata
 * - Audit integration
 * - Accounting event emission
 * - Reconciliation metadata
 * - Operational metrics
 * - Health monitoring
 * - Reversal hooks
 *
 * Architectural Rule
 * ----------------------------------------------------------------------------
 *
 * This service MUST NOT maintain a second accounting/ledger implementation.
 *
 * Financial state must ultimately be persisted through the existing:
 *
 *   Ledger Engine
 *       ↓
 *   Journal Service
 *       ↓
 *   Posting Engine
 *       ↓
 *   Account / JournalEntry / Transaction
 *
 * The savings service is therefore an orchestration layer.
 *
 * Required integration hook:
 *
 *   await savingsAccountingService.recordDeposit(payload)
 *
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * Optional Logger Resolution
 * ============================================================================
 */

let defaultLogger;

try {
  defaultLogger = require('./logger');
} catch {
  defaultLogger = console;
}

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SERVICE_NAME =
  'SavingsAccountingService';

const SERVICE_VERSION =
  '2026.1';

const ACCOUNTING_STATES = Object.freeze({
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  JOURNAL_CREATED: 'JOURNAL_CREATED',
  POSTED: 'POSTED',
  AUDITED: 'AUDITED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
});

const TRANSACTION_TYPES = Object.freeze({
  SAVINGS_DEPOSIT:
    'SAVINGS_DEPOSIT',

  SAVINGS_CONTRIBUTION:
    'SAVINGS_CONTRIBUTION',

  SAVINGS_REVERSAL:
    'SAVINGS_REVERSAL',
});

const DEFAULT_CONFIG = Object.freeze({
  defaultCurrency: 'UGX',

  idempotencyRequired: true,

  requireTenantId: true,

  requireMemberId: true,

  requireAccountId: true,

  requireReference: true,

  minimumAmount: 1,

  maximumAmount: 1000000000000,

  providers: [
    'MTN',
    'AIRTEL',
    'BANK',
    'CASH',
    'INTERNAL',
    'UNKNOWN',
  ],

  auditRequired: true,

  ledgerRequired: false,

  eventEmissionEnabled: true,

  reconciliationEnabled: true,

  allowUnknownProvider: true,
});

/**
 * ============================================================================
 * Utility Helpers
 * ============================================================================
 */

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function normalizeString(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value)
    .trim();
}

function normalizeUpper(
  value
) {
  return normalizeString(
    value
  ).toUpperCase();
}

function normalizeCurrency(
  value,
  fallback
) {
  const currency =
    normalizeUpper(
      value || fallback
    );

  if (
    !/^[A-Z]{3}$/.test(
      currency
    )
  ) {
    throw new TypeError(
      `Invalid currency code: ${currency}`
    );
  }

  return currency;
}

function parseAmount(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return null;
  }

  return numeric;
}

function createFingerprint(
  payload
) {
  const normalized =
    JSON.stringify(
      Object.keys(
        payload
      )
        .sort()
        .reduce(
          (
            result,
            key
          ) => {
            result[key] =
              payload[key];

            return result;
          },
          {}
        )
    );

  return crypto
    .createHash(
      'sha256'
    )
    .update(
      normalized
    )
    .digest('hex');
}

/**
 * ============================================================================
 * Savings Accounting Service
 * ============================================================================
 */

class SavingsAccountingService extends EventEmitter {
  constructor(
    options = {}
  ) {
    super();

    this.serviceName =
      SERVICE_NAME;

    this.serviceVersion =
      SERVICE_VERSION;

    this.logger =
      options.logger ||
      defaultLogger;

    this.db =
      options.db ||
      null;

    this.ledgerService =
      options.ledgerService ||
      null;

    this.journalService =
      options.journalService ||
      null;

    this.postingEngine =
      options.postingEngine ||
      null;

    this.auditService =
      options.auditService ||
      null;

    this.eventBus =
      options.eventBus ||
      null;

    this.queueService =
      options.queueService ||
      null;

    this.metricsService =
      options.metricsService ||
      null;

    this.cache =
      options.cache ||
      null;

    this.config =
      this.buildConfig(
        options.config ||
          {}
      );

    this.metrics = this.createEmptyMetrics();
  }

  /**
   * ==========================================================================
   * Configuration
   * ==========================================================================
   */

  buildConfig(
    overrides = {}
  ) {
    const config = {
      ...DEFAULT_CONFIG,
      ...overrides,
    };

    if (
      config.minimumAmount <
      0
    ) {
      throw new Error(
        'minimumAmount cannot be negative.'
      );
    }

    if (
      config.maximumAmount <=
      config.minimumAmount
    ) {
      throw new Error(
        'maximumAmount must exceed minimumAmount.'
      );
    }

    return config;
  }

  /**
   * ==========================================================================
   * RECORD DEPOSIT
   * ==========================================================================
   *
   * Primary integration hook:
   *
   *   await savingsAccountingService.recordDeposit(payload)
   *
   * ==========================================================================
   */

  async recordDeposit(
    payload = {},
    options = {}
  ) {
    const context =
      this.createContext(
        payload,
        options
      );

    const startedAt =
      Date.now();

    let accountingEntry;

    try {
      this.incrementMetric(
        'depositsReceived'
      );

      this.assertDepositPayload(
        payload
      );

      accountingEntry =
        this.buildAccountingEntry(
          payload,
          TRANSACTION_TYPES
            .SAVINGS_DEPOSIT,
          context
        );

      this.transition(
        accountingEntry,
        ACCOUNTING_STATES
          .RECEIVED
      );

      /**
       * --------------------------------------------------------------
       * IDEMPOTENCY
       * --------------------------------------------------------------
       */

      const existing =
        await this.findExistingEntry(
          accountingEntry,
          context
        );

      if (existing) {
        this.incrementMetric(
          'idempotentRequests'
        );

        this.logInfo(
          '[SAVINGS ACCOUNTING] Idempotent deposit request',
          {
            tenantId:
              accountingEntry.tenantId,
            reference:
              accountingEntry.reference,
            idempotencyKey:
              accountingEntry
                .idempotencyKey,
          }
        );

        return this.buildSuccessResponse(
          existing,
          true
        );
      }

      /**
       * --------------------------------------------------------------
       * VALIDATION
       * --------------------------------------------------------------
       */

      this.transition(
        accountingEntry,
        ACCOUNTING_STATES
          .VALIDATED
      );

      /**
       * --------------------------------------------------------------
       * JOURNAL
       * --------------------------------------------------------------
       */

      const journal =
        await this.createJournalEntry(
          accountingEntry,
          context
        );

      accountingEntry.journal =
        journal;

      this.transition(
        accountingEntry,
        ACCOUNTING_STATES
          .JOURNAL_CREATED
      );

      /**
       * --------------------------------------------------------------
       * LEDGER POSTING
       * --------------------------------------------------------------
       */

      const posting =
        await this.postToLedger(
          accountingEntry,
          journal,
          context
        );

      accountingEntry.posting =
        posting;

      this.transition(
        accountingEntry,
        ACCOUNTING_STATES
          .POSTED
      );

      /**
       * --------------------------------------------------------------
       * AUDIT
       * --------------------------------------------------------------
       */

      await this.recordAudit(
        'SAVINGS_DEPOSIT_POSTED',
        accountingEntry,
        context
      );

      this.transition(
        accountingEntry,
        ACCOUNTING_STATES
          .AUDITED
      );

      /**
       * --------------------------------------------------------------
       * RECONCILIATION METADATA
       * --------------------------------------------------------------
       */

      accountingEntry.reconciliation =
        this.buildReconciliationMetadata(
          accountingEntry,
          context
        );

      /**
       * --------------------------------------------------------------
       * FINALIZE
       * --------------------------------------------------------------
       */

      this.transition(
        accountingEntry,
        ACCOUNTING_STATES
          .COMPLETED
      );

      accountingEntry.completedAt =
        new Date().toISOString();

      accountingEntry.processingDurationMs =
        Date.now() -
        startedAt;

      await this.persistAccountingRecord(
        accountingEntry,
        context
      );

      this.incrementMetric(
        'depositsRecorded'
      );

      this.emitAccountingEvent(
        'savings.deposit.recorded',
        accountingEntry,
        context
      );

      this.logInfo(
        '[SAVINGS ACCOUNTING] Deposit recorded',
        {
          tenantId:
            accountingEntry.tenantId,
          memberId:
            accountingEntry.memberId,
          accountId:
            accountingEntry.accountId,
          reference:
            accountingEntry.reference,
          amount:
            accountingEntry.amount,
          currency:
            accountingEntry.currency,
          journalId:
            journal.journalId,
          state:
            accountingEntry.state,
        }
      );

      return this.buildSuccessResponse(
        accountingEntry,
        false
      );
    } catch (error) {
      this.incrementMetric(
        'failures'
      );

      if (
        accountingEntry
      ) {
        accountingEntry.state =
          ACCOUNTING_STATES
            .FAILED;

        accountingEntry.failedAt =
          new Date().toISOString();

        accountingEntry.error = {
          code:
            error.code ||
            'SAVINGS_ACCOUNTING_FAILURE',

          message:
            error.message,
        };
      }

      await this.safeFailureAudit(
        accountingEntry,
        error,
        context
      );

      this.logError(
        '[SAVINGS ACCOUNTING] Deposit failed',
        error,
        {
          tenantId:
            context.tenantId,
          memberId:
            payload.memberId,
          accountId:
            payload.accountId,
          reference:
            payload.reference,
          correlationId:
            context.correlationId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * RECORD SAVINGS CONTRIBUTION
   * ==========================================================================
   */

  async recordContribution(
    payload = {},
    options = {}
  ) {
    const context =
      this.createContext(
        payload,
        options
      );

    try {
      this.incrementMetric(
        'contributionsReceived'
      );

      this.assertContributionPayload(
        payload
      );

      /**
       * Contributions use the same accounting
       * pipeline as deposits.
       *
       * This prevents savings contributions
       * from bypassing ledger controls.
       */

      const entry =
        this.buildAccountingEntry(
          payload,
          TRANSACTION_TYPES
            .SAVINGS_CONTRIBUTION,
          context
        );

      const existing =
        await this.findExistingEntry(
          entry,
          context
        );

      if (existing) {
        this.incrementMetric(
          'idempotentRequests'
        );

        return this.buildSuccessResponse(
          existing,
          true
        );
      }

      this.transition(
        entry,
        ACCOUNTING_STATES
          .RECEIVED
      );

      this.transition(
        entry,
        ACCOUNTING_STATES
          .VALIDATED
      );

      const journal =
        await this.createJournalEntry(
          entry,
          context
        );

      entry.journal =
        journal;

      this.transition(
        entry,
        ACCOUNTING_STATES
          .JOURNAL_CREATED
      );

      const posting =
        await this.postToLedger(
          entry,
          journal,
          context
        );

      entry.posting =
        posting;

      this.transition(
        entry,
        ACCOUNTING_STATES
          .POSTED
      );

      await this.recordAudit(
        'SAVINGS_CONTRIBUTION_POSTED',
        entry,
        context
      );

      this.transition(
        entry,
        ACCOUNTING_STATES
          .AUDITED
      );

      entry.reconciliation =
        this.buildReconciliationMetadata(
          entry,
          context
        );

      this.transition(
        entry,
        ACCOUNTING_STATES
          .COMPLETED
      );

      entry.completedAt =
        new Date().toISOString();

      await this.persistAccountingRecord(
        entry,
        context
      );

      this.incrementMetric(
        'contributionsRecorded'
      );

      this.emitAccountingEvent(
        'savings.contribution.recorded',
        entry,
        context
      );

      return this.buildSuccessResponse(
        entry,
        false
      );
    } catch (error) {
      this.incrementMetric(
        'failures'
      );

      await this.safeFailureAudit(
        null,
        error,
        context
      );

      this.logError(
        '[SAVINGS ACCOUNTING] Contribution failed',
        error,
        {
          tenantId:
            context.tenantId,
          memberId:
            payload.memberId,
          reference:
            payload.reference,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * JOURNAL ENTRY
   * ==========================================================================
   *
   * This method intentionally delegates to the existing accounting engine.
   *
   * It does NOT create balances itself.
   *
   * ==========================================================================
   */

  async createJournalEntry(
    entry,
    context = {}
  ) {
    this.incrementMetric(
      'journalEntriesAttempted'
    );

    const journalPayload =
      this.buildJournalPayload(
        entry,
        context
      );

    /**
     * Existing Journal Service
     */

    if (
      this.journalService &&
      typeof this.journalService.createJournal ===
        'function'
    ) {
      const journal =
        await this.journalService.createJournal(
          journalPayload
        );

      this.incrementMetric(
        'journalEntriesCreated'
      );

      return {
        journalId:
          journal.id ||
          journal.journalId,

        ...journal,
      };
    }

    /**
     * Existing Ledger Service
     */

    if (
      this.ledgerService &&
      typeof this.ledgerService.createJournalEntry ===
        'function'
    ) {
      const journal =
        await this.ledgerService.createJournalEntry(
          journalPayload
        );

      this.incrementMetric(
        'journalEntriesCreated'
      );

      return {
        journalId:
          journal.id ||
          journal.journalId,

        ...journal,
      };
    }

    /**
     * Explicit fallback.
     *
     * This preserves compatibility with the current
     * architecture while making it obvious that a
     * real ledger service should eventually be injected.
     */

    if (
      this.config.ledgerRequired
    ) {
      const error =
        new Error(
          'Ledger/Journal service is required but unavailable.'
        );

      error.code =
        'LEDGER_SERVICE_UNAVAILABLE';

      throw error;
    }

    const fallback =
      {
        journalId:
          crypto.randomUUID(),

        status:
          'PENDING_EXTERNAL_POSTING',

        transactionType:
          entry.transactionType,

        tenantId:
          entry.tenantId,

        reference:
          entry.reference,

        amount:
          entry.amount,

        currency:
          entry.currency,

        createdAt:
          new Date().toISOString(),
      };

    this.incrementMetric(
      'journalEntriesCreated'
    );

    this.logWarn(
      '[SAVINGS ACCOUNTING] Journal service unavailable; fallback journal generated',
      {
        journalId:
          fallback.journalId,
        reference:
          entry.reference,
      }
    );

    return fallback;
  }

  /**
   * ==========================================================================
   * LEDGER POSTING
   * ==========================================================================
   */

  async postToLedger(
    entry,
    journal,
    context = {}
  ) {
    const postingPayload =
      this.buildPostingPayload(
        entry,
        journal,
        context
      );

    /**
     * Preferred Posting Engine
     */

    if (
      this.postingEngine &&
      typeof this.postingEngine.post ===
        'function'
    ) {
      const result =
        await this.postingEngine.post(
          postingPayload
        );

      this.incrementMetric(
        'ledgerPostings'
      );

      return {
        postingId:
          result.id ||
          result.postingId ||
          crypto.randomUUID(),

        status:
          result.status ||
          'POSTED',

        ...result,
      };
    }

    /**
     * Ledger Service fallback
     */

    if (
      this.ledgerService &&
      typeof this.ledgerService.post ===
        'function'
    ) {
      const result =
        await this.ledgerService.post(
          postingPayload
        );

      this.incrementMetric(
        'ledgerPostings'
      );

      return {
        postingId:
          result.id ||
          result.postingId ||
          crypto.randomUUID(),

        status:
          result.status ||
          'POSTED',

        ...result,
      };
    }

    if (
      this.config.ledgerRequired
    ) {
      const error =
        new Error(
          'Ledger posting service is required but unavailable.'
        );

      error.code =
        'LEDGER_POSTING_UNAVAILABLE';

      throw error;
    }

    /**
     * Compatibility fallback.
     *
     * IMPORTANT:
     * This does NOT update balances.
     */

    const fallback =
      {
        postingId:
          crypto.randomUUID(),

        status:
          'PENDING_EXTERNAL_POSTING',

        journalId:
          journal.journalId,

        createdAt:
          new Date().toISOString(),
      };

    this.logWarn(
      '[SAVINGS ACCOUNTING] Ledger posting service unavailable; posting deferred',
      {
        journalId:
          journal.journalId,
        reference:
          entry.reference,
      }
    );

    return fallback;
  }

  /**
   * ==========================================================================
   * JOURNAL PAYLOAD
   * ==========================================================================
   */

  buildJournalPayload(
    entry,
    context
  ) {
    return {
      journalId:
        entry.journalId,

      tenantId:
        entry.tenantId,

      transactionType:
        entry.transactionType,

      reference:
        entry.reference,

      idempotencyKey:
        entry.idempotencyKey,

      memberId:
        entry.memberId,

      accountId:
        entry.accountId,

      provider:
        entry.provider,

      amount:
        entry.amount,

      currency:
        entry.currency,

      correlationId:
        context.correlationId,

      source:
        'SAVINGS_ACCOUNTING',

      metadata: {
        serviceName:
          this.serviceName,

        serviceVersion:
          this.serviceVersion,

        providerTransactionId:
          entry.providerTransactionId,

        externalReference:
          entry.externalReference,
      },

      createdAt:
        entry.createdAt,
    };
  }

  /**
   * ==========================================================================
   * POSTING PAYLOAD
   * ==========================================================================
   */

  buildPostingPayload(
    entry,
    journal,
    context
  ) {
    return {
      tenantId:
        entry.tenantId,

      journalId:
        journal.journalId,

      transactionType:
        entry.transactionType,

      reference:
        entry.reference,

      idempotencyKey:
        entry.idempotencyKey,

      memberId:
        entry.memberId,

      accountId:
        entry.accountId,

      provider:
        entry.provider,

      amount:
        entry.amount,

      currency:
        entry.currency,

      correlationId:
        context.correlationId,

      source:
        'SAVINGS_ACCOUNTING',

      metadata: {
        providerTransactionId:
          entry.providerTransactionId,

        externalReference:
          entry.externalReference,

        reconciliationKey:
          entry.reconciliation
            ?.reconciliationKey ||
          entry.idempotencyKey,
      },
    };
  }

  /**
   * ==========================================================================
   * ACCOUNTING ENTRY
   * ==========================================================================
   */

  buildAccountingEntry(
    payload,
    transactionType,
    context
  ) {
    const amount =
      parseAmount(
        payload.amount
      );

    const currency =
      normalizeCurrency(
        payload.currency,
        this.config
          .defaultCurrency
      );

    const provider =
      normalizeUpper(
        payload.provider ||
          'UNKNOWN'
      );

    const reference =
      normalizeString(
        payload.reference
      );

    const memberId =
      normalizeString(
        payload.memberId
      );

    const accountId =
      normalizeString(
        payload.accountId
      );

    const idempotencyKey =
      normalizeString(
        payload.idempotencyKey ||
          payload.reference
      );

    const createdAt =
      new Date().toISOString();

    const entry = {
      entryId:
        crypto.randomUUID(),

      journalId:
        crypto.randomUUID(),

      transactionType,

      tenantId:
        context.tenantId,

      memberId,

      accountId,

      provider,

      reference,

      externalReference:
        normalizeString(
          payload.externalReference
        ) || null,

      providerTransactionId:
        normalizeString(
          payload.providerTransactionId
        ) || null,

      amount,

      currency,

      idempotencyKey,

      correlationId:
        context.correlationId,

      source:
        payload.source ||
        'SAVINGS_ACCOUNTING',

      state:
        ACCOUNTING_STATES
          .RECEIVED,

      createdAt,

      immutable: true,

      metadata:
        isObject(
          payload.metadata
        )
          ? {
              ...payload.metadata,
            }
          : {},

      fingerprint:
        createFingerprint({
          tenantId:
            context.tenantId,

          transactionType,

          memberId,

          accountId,

          reference,

          idempotencyKey,

          amount,

          currency,

          provider,
        }),
    };

    return entry;
  }

  /**
   * ==========================================================================
   * RECONCILIATION METADATA
   * ==========================================================================
   */

  buildReconciliationMetadata(
    entry,
    context
  ) {
    if (
      !this.config.reconciliationEnabled
    ) {
      return {
        enabled: false,
      };
    }

    return {
      enabled: true,

      reconciliationKey:
        createFingerprint({
          tenantId:
            entry.tenantId,

          provider:
            entry.provider,

          providerTransactionId:
            entry.providerTransactionId,

          externalReference:
            entry.externalReference,

          reference:
            entry.reference,

          amount:
            entry.amount,

          currency:
            entry.currency,
        }),

      status:
        'PENDING_RECONCILIATION',

      provider:
        entry.provider,

      providerTransactionId:
        entry.providerTransactionId,

      externalReference:
        entry.externalReference,

      createdAt:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * IDEMPOTENCY
   * ==========================================================================
   */

  async findExistingEntry(
    entry,
    context
  ) {
    if (
      !this.config.idempotencyRequired
    ) {
      return null;
    }

    /**
     * Database lookup
     */

    if (
      this.db &&
      this.db.savingsAccounting &&
      typeof this.db.savingsAccounting.findOne ===
        'function'
    ) {
      return this.db.savingsAccounting.findOne({
        tenantId:
          entry.tenantId,

        idempotencyKey:
          entry.idempotencyKey,

        transactionType:
          entry.transactionType,
      });
    }

    /**
     * Ledger lookup
     */

    if (
      this.ledgerService &&
      typeof this.ledgerService.findByIdempotencyKey ===
        'function'
    ) {
      return this.ledgerService.findByIdempotencyKey(
        entry.idempotencyKey,
        {
          tenantId:
            entry.tenantId,

          transactionType:
            entry.transactionType,
        }
      );
    }

    return null;
  }

  /**
   * ==========================================================================
   * PERSIST ACCOUNTING RECORD
   * ==========================================================================
   */

  async persistAccountingRecord(
    entry,
    context
  ) {
    if (
      !this.db ||
      !this.db.savingsAccounting ||
      typeof this.db.savingsAccounting.create !==
        'function'
    ) {
      return entry;
    }

    try {
      return await this.db.savingsAccounting.create(
        entry
      );
    } catch (error) {
      /**
       * Duplicate key can occur if two provider callbacks
       * race each other.
       */

      if (
        this.isDuplicateKeyError(
          error
        )
      ) {
        const existing =
          await this.findExistingEntry(
            entry,
            context
          );

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * REVERSAL HOOK
   * ==========================================================================
   *
   * Financial records must never be edited.
   *
   * Reversals create compensating accounting entries.
   * ==========================================================================
   */

  async reverseDeposit(
    payload = {},
    options = {}
  ) {
    const context =
      this.createContext(
        payload,
        options
      );

    this.assertTenantId(
      context.tenantId
    );

    const originalEntryId =
      normalizeString(
        payload.entryId
      );

    const originalReference =
      normalizeString(
        payload.reference
      );

    if (
      !originalEntryId &&
      !originalReference
    ) {
      throw new Error(
        'entryId or reference is required for deposit reversal.'
      );
    }

    const reversalPayload = {
      ...payload,

      amount:
        payload.amount,

      transactionType:
        TRANSACTION_TYPES
          .SAVINGS_REVERSAL,

      reference:
        payload.reversalReference ||
        `REVERSAL-${originalReference || originalEntryId}`,

      originalEntryId:
        originalEntryId ||
        null,

      originalReference:
        originalReference ||
        null,

      idempotencyKey:
        payload.idempotencyKey ||
        `REVERSAL:${context.tenantId}:${originalEntryId || originalReference}`,
    };

    const entry =
      this.buildAccountingEntry(
        reversalPayload,
        TRANSACTION_TYPES
          .SAVINGS_REVERSAL,
        context
      );

    entry.reversal = {
      originalEntryId:
        originalEntryId ||
        null,

      originalReference:
        originalReference ||
        null,

      reason:
        normalizeString(
          payload.reason
        ),

      requestedBy:
        normalizeString(
          payload.requestedBy
        ) || null,

      requestedAt:
        new Date().toISOString(),
    };

    const journal =
      await this.createJournalEntry(
        entry,
        context
      );

    entry.journal =
      journal;

    const posting =
      await this.postToLedger(
        entry,
        journal,
        context
      );

    entry.posting =
      posting;

    entry.state =
      ACCOUNTING_STATES
        .REVERSED;

    await this.recordAudit(
      'SAVINGS_DEPOSIT_REVERSED',
      entry,
      context
    );

    await this.persistAccountingRecord(
      entry,
      context
    );

    this.emitAccountingEvent(
      'savings.deposit.reversed',
      entry,
      context
    );

    return this.buildSuccessResponse(
      entry,
      false
    );
  }

  /**
   * ==========================================================================
   * AUDIT
   * ==========================================================================
   */

  async recordAudit(
    event,
    payload,
    context = {}
  ) {
    this.incrementMetric(
      'auditEvents'
    );

    if (
      this.auditService &&
      typeof this.auditService.log ===
        'function'
    ) {
      await this.auditService.log({
        event,

        action:
          event,

        tenantId:
          payload?.tenantId ||
          context.tenantId,

        memberId:
          payload?.memberId ||
          null,

        accountId:
          payload?.accountId ||
          null,

        reference:
          payload?.reference ||
          null,

        transactionType:
          payload?.transactionType ||
          null,

        amount:
          payload?.amount ||
          null,

        currency:
          payload?.currency ||
          null,

        correlationId:
          context.correlationId ||
          null,

        service:
          this.serviceName,

        serviceVersion:
          this.serviceVersion,

        timestamp:
          new Date(),
      });

      return true;
    }

    /**
     * Compatibility logging fallback.
     */

    if (
      this.config.auditRequired
    ) {
      this.logInfo(
        '[SAVINGS AUDIT]',
        {
          event,
          tenantId:
            payload?.tenantId,
          reference:
            payload?.reference,
          transactionType:
            payload?.transactionType,
          timestamp:
            new Date().toISOString(),
        }
      );
    }

    return true;
  }

  /**
   * ==========================================================================
   * SAFE FAILURE AUDIT
   * ==========================================================================
   */

  async safeFailureAudit(
    entry,
    error,
    context
  ) {
    try {
      await this.recordAudit(
        'SAVINGS_ACCOUNTING_FAILED',
        {
          ...(entry || {}),

          errorCode:
            error?.code ||
            'UNKNOWN',

          errorMessage:
            error?.message ||
            'Unknown accounting error',
        },
        context
      );
    } catch (
      auditError
    ) {
      this.logError(
        '[SAVINGS ACCOUNTING] Failure audit failed',
        auditError,
        {
          originalError:
            error?.message,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * EVENTS
   * ==========================================================================
   */

  emitAccountingEvent(
    eventName,
    payload,
    context
  ) {
    if (
      !this.config
        .eventEmissionEnabled
    ) {
      return;
    }

    const event = {
      eventId:
        crypto.randomUUID(),

      eventName,

      service:
        this.serviceName,

      serviceVersion:
        this.serviceVersion,

      tenantId:
        payload.tenantId,

      memberId:
        payload.memberId,

      accountId:
        payload.accountId,

      reference:
        payload.reference,

      transactionType:
        payload.transactionType,

      amount:
        payload.amount,

      currency:
        payload.currency,

      journalId:
        payload.journal
          ?.journalId ||
        null,

      postingId:
        payload.posting
          ?.postingId ||
        null,

      correlationId:
        context.correlationId ||
        null,

      occurredAt:
        new Date().toISOString(),
    };

    try {
      this.emit(
        eventName,
        event
      );
    } catch (
      error
    ) {
      this.logError(
        '[SAVINGS ACCOUNTING] Event listener failed',
        error,
        {
          eventName,
        }
      );
    }

    if (
      this.eventBus &&
      typeof this.eventBus.publish ===
        'function'
    ) {
      Promise.resolve(
        this.eventBus.publish(
          eventName,
          event
        )
      ).catch(
        (error) => {
          this.logError(
            '[SAVINGS ACCOUNTING] Event publication failed',
            error,
            {
              eventName,
            }
          );
        }
      );
    }
  }

  /**
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  assertDepositPayload(
    payload
  ) {
    this.assertBasePayload(
      payload
    );
  }

  assertContributionPayload(
    payload
  ) {
    this.assertBasePayload(
      payload
    );
  }

  assertBasePayload(
    payload
  ) {
    if (
      !isObject(payload)
    ) {
      const error =
        new TypeError(
          'Accounting payload must be an object.'
        );

      error.code =
        'INVALID_ACCOUNTING_PAYLOAD';

      throw error;
    }

    const amount =
      parseAmount(
        payload.amount
      );

    if (
      amount === null
    ) {
      const error =
        new TypeError(
          'A valid deposit amount is required.'
        );

      error.code =
        'INVALID_AMOUNT';

      throw error;
    }

    if (
      amount <
      this.config.minimumAmount
    ) {
      const error =
        new RangeError(
          `Amount must be at least ${this.config.minimumAmount}.`
        );

      error.code =
        'AMOUNT_BELOW_MINIMUM';

      throw error;
    }

    if (
      amount >
      this.config.maximumAmount
    ) {
      const error =
        new RangeError(
          `Amount exceeds maximum permitted amount of ${this.config.maximumAmount}.`
        );

      error.code =
        'AMOUNT_ABOVE_MAXIMUM';

      throw error;
    }

    if (
      this.config.requireTenantId &&
      !normalizeString(
        payload.tenantId
      )
    ) {
      const error =
        new TypeError(
          'tenantId is required.'
        );

      error.code =
        'TENANT_ID_REQUIRED';

      throw error;
    }

    if (
      this.config.requireMemberId &&
      !normalizeString(
        payload.memberId
      )
    ) {
      const error =
        new TypeError(
          'memberId is required.'
        );

      error.code =
        'MEMBER_ID_REQUIRED';

      throw error;
    }

    if (
      this.config.requireAccountId &&
      !normalizeString(
        payload.accountId
      )
    ) {
      const error =
        new TypeError(
          'accountId is required.'
        );

      error.code =
        'ACCOUNT_ID_REQUIRED';

      throw error;
    }

    if (
      this.config.requireReference &&
      !normalizeString(
        payload.reference
      )
    ) {
      const error =
        new TypeError(
          'reference is required.'
        );

      error.code =
        'REFERENCE_REQUIRED';

      throw error;
    }

    const provider =
      normalizeUpper(
        payload.provider ||
          'UNKNOWN'
      );

    if (
      !this.config
        .allowUnknownProvider &&
      provider === 'UNKNOWN'
    ) {
      const error =
        new Error(
          'Unknown payment provider is not permitted.'
        );

      error.code =
        'UNKNOWN_PROVIDER';

      throw error;
    }

    if (
      this.config.providers.length &&
      !this.config.providers.includes(
        provider
      ) &&
      !this.config.allowUnknownProvider
    ) {
      const error =
        new Error(
          `Unsupported payment provider: ${provider}`
        );

      error.code =
        'UNSUPPORTED_PROVIDER';

      throw error;
    }
  }

  /**
   * ==========================================================================
   * ACCOUNTING STATE
   * ==========================================================================
   */

  transition(
    entry,
    nextState
  ) {
    if (
      !entry
    ) {
      return;
    }

    entry.state =
      nextState;

    entry.stateChangedAt =
      new Date().toISOString();
  }

  /**
   * ==========================================================================
   * CONTEXT
   * ==========================================================================
   */

  createContext(
    payload,
    options
  ) {
    return {
      tenantId:
        normalizeString(
          options.tenantId ||
            payload.tenantId
        ),

      correlationId:
        normalizeString(
          options.correlationId ||
            payload.correlationId ||
            payload.requestId
        ) ||
        crypto.randomUUID(),

      actorId:
        normalizeString(
          options.actorId ||
            payload.actorId
        ) || null,

      source:
        options.source ||
        payload.source ||
        'SAVINGS_ACCOUNTING',
    };
  }

  /**
   * ==========================================================================
   * RESPONSE
   * ==========================================================================
   */

  buildSuccessResponse(
    entry,
    idempotent
  ) {
    return {
      success: true,

      idempotent:

        Boolean(
          idempotent
        ),

      entry,

      entryId:
        entry.entryId ||
        entry.id,

      journalId:
        entry.journal
          ?.journalId ||
        null,

      postingId:
        entry.posting
          ?.postingId ||
        null,

      state:
        entry.state,

      reference:
        entry.reference,

      amount:
        entry.amount,

      currency:
        entry.currency,
    };
  }

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  healthCheck() {
    const ledgerAvailable =
      Boolean(
        this.ledgerService ||
          this.postingEngine ||
          this.journalService
      );

    const auditAvailable =
      Boolean(
        this.auditService
      );

    return {
      healthy: true,

      service:
        this.serviceName,

      version:
        this.serviceVersion,

      ledgerIntegration:
        ledgerAvailable
          ? 'available'
          : 'fallback',

      auditIntegration:
        auditAvailable
          ? 'available'
          : 'fallback',

      eventBus:
        this.eventBus
          ? 'available'
          : 'unavailable',

      timestamp:
        new Date().toISOString(),
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

      version:
        this.serviceVersion,

      ...this.metrics,

      timestamp:
        new Date().toISOString(),
    };
  }

  createEmptyMetrics() {
    return {
      depositsReceived: 0,

      depositsRecorded: 0,

      contributionsReceived: 0,

      contributionsRecorded: 0,

      journalEntriesAttempted: 0,

      journalEntriesCreated: 0,

      ledgerPostings: 0,

      auditEvents: 0,

      failures: 0,

      idempotentRequests: 0,
    };
  }

  incrementMetric(
    name,
    amount = 1
  ) {
    if (
      !Object.prototype.hasOwnProperty.call(
        this.metrics,
        name
      )
    ) {
      this.metrics[name] =
        0;
    }

    this.metrics[name] +=
      amount;

    if (
      this.metricsService &&
      typeof this.metricsService.increment ===
        'function'
    ) {
      try {
        this.metricsService.increment(
          `savings_accounting_${name}`,
          amount
        );
      } catch (
        error
      ) {
        this.logWarn(
          '[SAVINGS ACCOUNTING] Metrics integration failed',
          {
            metric:
              name,
            error:
              error.message,
          }
        );
      }
    }
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
    if (
      this.logger &&
      typeof this.logger.info ===
        'function'
    ) {
      this.logger.info(
        message,
        {
          service:
            this.serviceName,

          version:
            this.serviceVersion,

          ...metadata,
        }
      );
    }
  }

  logWarn(
    message,
    metadata = {}
  ) {
    if (
      this.logger &&
      typeof this.logger.warn ===
        'function'
    ) {
      this.logger.warn(
        message,
        {
          service:
            this.serviceName,

          version:
            this.serviceVersion,

          ...metadata,
        }
      );
    }
  }

  logError(
    message,
    error,
    metadata = {}
  ) {
    if (
      this.logger &&
      typeof this.logger.error ===
        'function'
    ) {
      this.logger.error(
        message,
        {
          service:
            this.serviceName,

          version:
            this.serviceVersion,

          error:
            error
              ? {
                  name:
                    error.name,

                  message:
                    error.message,

                  code:
                    error.code,

                  stack:
                    error.stack,
                }
              : undefined,

          ...metadata,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * ERROR HELPERS
   * ==========================================================================
   */

  isDuplicateKeyError(
    error
  ) {
    return Boolean(
      error &&
        (
          error.code === 11000 ||
          error.codeName ===
            'DuplicateKey'
        )
    );
  }
}

/**
 * ============================================================================
 * Singleton Export
 * ============================================================================
 *
 * Existing integrations expect:
 *
 *   const savingsAccountingService =
 *     require('./savingsAccountingService');
 *
 * Therefore the default export remains a singleton.
 *
 * For advanced testing / dependency injection:
 *
 *   const SavingsAccountingService =
 *     require('./savingsAccountingService').SavingsAccountingService;
 *
 * ============================================================================
 */

const savingsAccountingService =
  new SavingsAccountingService();

module.exports =
  savingsAccountingService;

module.exports.SavingsAccountingService =
  SavingsAccountingService;

module.exports.ACCOUNTING_STATES =
  ACCOUNTING_STATES;

module.exports.TRANSACTION_TYPES =
  TRANSACTION_TYPES;