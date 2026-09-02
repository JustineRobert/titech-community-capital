'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Financial Ledger Reversal Service
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/ledger/reversalService.js
 *
 * Purpose
 * -------
 * Production-grade reversal orchestration for immutable double-entry ledger
 * records.
 *
 * Core accounting rule
 * --------------------
 * Financial history is immutable.
 *
 * A posted journal is NEVER:
 *
 *   - edited
 *   - deleted
 *   - rewritten
 *   - marked as if it never happened
 *
 * Instead, a reversal creates a NEW compensating journal whose entries are the
 * exact inverse of the original journal:
 *
 * Original:
 *
 *   DEBIT   A   100,000
 *   CREDIT  B   100,000
 *
 * Reversal:
 *
 *   DEBIT   B   100,000
 *   CREDIT  A   100,000
 *
 * Architectural boundary
 * ----------------------
 *
 *   Business Operation
 *          |
 *          v
 *   ReversalService
 *          |
 *          +--> validate original journal
 *          +--> validate tenant
 *          +--> validate reversal policy
 *          +--> enforce idempotency
 *          +--> create compensating instructions
 *          |
 *          v
 *     PostingEngine
 *          |
 *          v
 *     LedgerEngine
 *          |
 *          +--> Journal
 *          +--> JournalEntry
 *
 * Responsibilities
 * ----------------
 * - locate original journal
 * - validate reversal eligibility
 * - prevent cross-tenant reversal
 * - prevent self-reversal
 * - prevent duplicate reversal
 * - generate deterministic reversal identity
 * - create compensating entries
 * - preserve original journal immutability
 * - delegate financial posting to PostingEngine/LedgerEngine
 * - maintain linkage between original and reversal
 * - support operational reconciliation
 * - expose deterministic result metadata
 * - emit audit/events
 *
 * This service MUST NOT directly mutate account balances.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const REVERSAL_STATUS = Object.freeze({
  RECEIVED:
    'RECEIVED',

  VALIDATING:
    'VALIDATING',

  READY:
    'READY',

  PROCESSING:
    'PROCESSING',

  COMPLETED:
    'COMPLETED',

  REPLAYED:
    'REPLAYED',

  FAILED:
    'FAILED',

  UNKNOWN:
    'UNKNOWN',

  REQUIRES_RECONCILIATION:
    'REQUIRES_RECONCILIATION',
});

const JOURNAL_STATUS = Object.freeze({
  DRAFT:
    'DRAFT',

  POSTING:
    'POSTING',

  POSTED:
    'POSTED',

  REVERSED:
    'REVERSED',

  VOIDED:
    'VOIDED',

  FAILED:
    'FAILED',
});

const ENTRY_TYPE = Object.freeze({
  DEBIT:
    'DEBIT',

  CREDIT:
    'CREDIT',
});

const REVERSAL_REASON_CODES = Object.freeze({
  CUSTOMER_REQUEST:
    'CUSTOMER_REQUEST',

  DUPLICATE_TRANSACTION:
    'DUPLICATE_TRANSACTION',

  FAILED_SETTLEMENT:
    'FAILED_SETTLEMENT',

  PROVIDER_REVERSAL:
    'PROVIDER_REVERSAL',

  INCORRECT_POSTING:
    'INCORRECT_POSTING',

  FRAUD:
    'FRAUD',

  COMPLIANCE:
    'COMPLIANCE',

  SYSTEM_ERROR:
    'SYSTEM_ERROR',

  ACCOUNTING_ADJUSTMENT:
    'ACCOUNTING_ADJUSTMENT',

  OTHER:
    'OTHER',
});

const REVERSAL_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'LEDGER_REVERSAL_INVALID_REQUEST',

  TENANT_REQUIRED:
    'LEDGER_REVERSAL_TENANT_REQUIRED',

  JOURNAL_REQUIRED:
    'LEDGER_REVERSAL_JOURNAL_REQUIRED',

  JOURNAL_NOT_FOUND:
    'LEDGER_REVERSAL_JOURNAL_NOT_FOUND',

  TRANSACTION_NOT_FOUND:
    'LEDGER_REVERSAL_TRANSACTION_NOT_FOUND',

  JOURNAL_NOT_POSTED:
    'LEDGER_REVERSAL_JOURNAL_NOT_POSTED',

  ALREADY_REVERSED:
    'LEDGER_REVERSAL_ALREADY_REVERSED',

  REVERSAL_EXISTS:
    'LEDGER_REVERSAL_ALREADY_EXISTS',

  SELF_REVERSAL:
    'LEDGER_REVERSAL_SELF_REFERENCE',

  TENANT_MISMATCH:
    'LEDGER_REVERSAL_TENANT_MISMATCH',

  CURRENCY_MISMATCH:
    'LEDGER_REVERSAL_CURRENCY_MISMATCH',

  ENTRY_MISMATCH:
    'LEDGER_REVERSAL_ENTRY_MISMATCH',

  BALANCE_MISMATCH:
    'LEDGER_REVERSAL_BALANCE_MISMATCH',

  REASON_REQUIRED:
    'LEDGER_REVERSAL_REASON_REQUIRED',

  IDEMPOTENCY_REQUIRED:
    'LEDGER_REVERSAL_IDEMPOTENCY_REQUIRED',

  IDEMPOTENCY_CONFLICT:
    'LEDGER_REVERSAL_IDEMPOTENCY_CONFLICT',

  PROCESSING_CONFLICT:
    'LEDGER_REVERSAL_PROCESSING_CONFLICT',

  PERIOD_CLOSED:
    'LEDGER_REVERSAL_PERIOD_CLOSED',

  INVALID_DATE:
    'LEDGER_REVERSAL_INVALID_DATE',

  POSTING_ENGINE_REQUIRED:
    'LEDGER_REVERSAL_POSTING_ENGINE_REQUIRED',

  LEDGER_ENGINE_REQUIRED:
    'LEDGER_REVERSAL_LEDGER_ENGINE_REQUIRED',

  REPOSITORY_REQUIRED:
    'LEDGER_REVERSAL_REPOSITORY_REQUIRED',

  PERSISTENCE_ERROR:
    'LEDGER_REVERSAL_PERSISTENCE_ERROR',

  CONCURRENCY_CONFLICT:
    'LEDGER_REVERSAL_CONCURRENCY_CONFLICT',

  UNKNOWN_OUTCOME:
    'LEDGER_REVERSAL_UNKNOWN_OUTCOME',

  RECONCILIATION_REQUIRED:
    'LEDGER_REVERSAL_RECONCILIATION_REQUIRED',

  CONFIGURATION_ERROR:
    'LEDGER_REVERSAL_CONFIGURATION_ERROR',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode:
    true,

  requireTenant:
    true,

  requireIdempotency:
    true,

  requireReasonCode:
    true,

  requireOriginalJournalId:
    false,

  allowTransactionLookup:
    true,

  onlyPostedJournals:
    true,

  prohibitMultipleReversals:
    true,

  prohibitSelfReversal:
    true,

  immutableHistory:
    true,

  requireOriginalEntries:
    true,

  requireBalancedOriginal:
    true,

  requireAtomicPosting:
    true,

  requirePostingEngine:
    true,

  validateAccountingPeriod:
    true,

  publishEvents:
    true,

  failOnEventPublicationError:
    false,

  failOnAuditError:
    false,

  maxDescriptionLength:
    1000,

  maxReferenceLength:
    255,

  maxMetadataDepth:
    8,

  maxMetadataKeys:
    100,

  maxMetadataStringLength:
    5000,
});

/* ============================================================================
 * Error
 * ========================================================================== */

class ReversalServiceError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'ReversalServiceError';

    this.code =
      options.code ||
      REVERSAL_ERROR_CODES
        .INVALID_REQUEST;

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 400;

    this.tenantId =
      options.tenantId ||
      null;

    this.journalId =
      options.journalId ||
      null;

    this.originalJournalId =
      options.originalJournalId ||
      null;

    this.reversalJournalId =
      options.reversalJournalId ||
      null;

    this.transactionId =
      options.transactionId ||
      null;

    this.idempotencyKey =
      options.idempotencyKey ||
      null;

    this.reasonCode =
      options.reasonCode ||
      null;

    this.retryable =
      options.retryable === true;

    this.unknownOutcome =
      options.unknownOutcome ===
      true;

    this.reconciliationRequired =
      options.reconciliationRequired ===
      true;

    this.details =
      options.details ||
      {};

    if (
      options.cause
    ) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      ReversalServiceError,
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
  return isNonEmptyString(
    value,
  )
    ? value.trim()
    : null;
}

function normalizeStatus(
  value,
) {
  const status =
    normalizeString(
      value,
    );

  return status
    ? status.toUpperCase()
    : null;
}

function normalizeCurrency(
  value,
) {
  const currency =
    normalizeString(
      value,
    );

  return currency
    ? currency.toUpperCase()
    : null;
}

function safeId(
  value,
) {
  if (
    value &&
    typeof value.toString ===
      'function'
  ) {
    return value.toString();
  }

  return normalizeString(
    value,
  );
}

function normalizeAccountId(
  value,
) {
  if (
    value &&
    typeof value ===
      'object'
  ) {
    return safeId(
      value._id ||
        value.id,
    );
  }

  return safeId(
    value,
  );
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
      // Continue.
    }
  }

  try {
    return JSON.parse(
      JSON.stringify(
        value,
      ),
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
    typeof value !==
      'object'
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
      typeof value ===
        'string'
        ? value
        : stableStringify(
            value,
          ),
    )
    .digest('hex');
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function parseDate(
  value,
) {
  if (
    value instanceof Date
  ) {
    return Number.isNaN(
      value.getTime(),
    )
      ? null
      : value;
  }

  if (
    !value
  ) {
    return null;
  }

  const parsed =
    new Date(
      value,
    );

  return Number.isNaN(
    parsed.getTime(),
  )
    ? null
    : parsed;
}

function createReversalOperationId() {
  return `reversal_op_${crypto.randomUUID()}`;
}

function createReversalReference() {
  return `REV-${Date.now()
    .toString(36)
    .toUpperCase()}-${crypto
    .randomBytes(4)
    .toString('hex')
    .toUpperCase()}`;
}

/* ============================================================================
 * Reversal Service
 * ========================================================================== */

class ReversalService {
  constructor(
    dependencies = {},
  ) {
    this.postingEngine =
      dependencies.postingEngine ||
      null;

    this.ledgerEngine =
      dependencies.ledgerEngine ||
      null;

    this.journalRepository =
      dependencies.journalRepository ||
      null;

    this.journalEntryRepository =
      dependencies.journalEntryRepository ||
      null;

    this.idempotencyService =
      dependencies.idempotencyService ||
      null;

    this.periodCloseService =
      dependencies.periodCloseService ||
      null;

    this.eventPublisher =
      dependencies.eventPublisher ||
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
   * Primary API
   * ======================================================================== */

  /**
   * Reverse an already posted journal.
   *
   * Preferred usage:
   *
   * await reversalService.reverse({
   *   tenantId,
   *   journalId,
   *   idempotencyKey,
   *   reasonCode: 'DUPLICATE_TRANSACTION',
   *   description: 'Reverse duplicate payment posting',
   * });
   */
  async reverse(
    input = {},
  ) {
    const request =
      this._normalizeRequest(
        input,
      );

    request.operationId =
      request.operationId ||
      createReversalOperationId();

    this._validateRequest(
      request,
    );

    this._metric(
      'ledger_reversal_received_total',
      1,
      {
        reasonCode:
          request.reasonCode ||
          'UNSPECIFIED',
      },
    );

    const original =
      await this._loadOriginalJournal(
        request,
      );

    this._validateOriginalJournal(
      original,
      request,
    );

    await this._validateAccountingPeriod(
      request,
      original,
    );

    const existing =
      await this._findExistingReversal(
        request,
        original,
      );

    if (
      existing
    ) {
      this._metric(
        'ledger_reversal_replayed_total',
        1,
      );

      return this._buildReplayResult(
        existing,
        original,
      );
    }

    const reversalEntries =
      this._buildReversalEntries(
        original.entries,
        original.journal,
      );

    this._validateReversalEntries(
      original,
      reversalEntries,
      request,
    );

    const reversalCommand =
      this._buildReversalCommand(
        request,
        original,
        reversalEntries,
      );

    const idempotency =
      await this._reserveIdempotency(
        request,
        original,
        reversalCommand,
      );

    if (
      idempotency?.completed
      && idempotency.result
    ) {
      return idempotency.result;
    }

    let result;

    try {
      result =
        await this._executeReversal(
          request,
          original,
          reversalCommand,
        );
    } catch (error) {
      await this._handleFailure(
        request,
        idempotency,
        error,
      );

      throw this._normalizeError(
        error,
        request,
      );
    }

    /**
     * Link the original journal to the compensating journal only after the
     * compensating financial posting has been successfully created.
     */
    try {
      await this._linkOriginalToReversal(
        original,
        result,
        request,
      );
    } catch (error) {
      /**
       * The reversal journal is already financial truth. Failure to write a
       * linkage marker must never cause the system to create a second reversal.
       * Surface the issue for reconciliation.
       */
      await this._markUnknownSafe(
        idempotency,
        request,
        error,
      );

      throw new ReversalServiceError(
        'Reversal was posted but the original/reversal linkage could not be finalized.',
        {
          code:
            REVERSAL_ERROR_CODES
              .RECONCILIATION_REQUIRED,

          statusCode:
            503,

          tenantId:
            request.tenantId,

          originalJournalId:
            original.journal.id,

          reversalJournalId:
            result.journalId,

          idempotencyKey:
            request.idempotencyKey,

          reconciliationRequired:
            true,

          retryable:
            false,

          cause:
            error,
        },
      );
    }

    const finalResult =
      this._buildResult(
        request,
        original,
        result,
        {
          replay:
            false,
        },
      );

    try {
      await this._completeIdempotency(
        idempotency,
        finalResult,
        request,
      );
    } catch (error) {
      /**
       * Financial posting already exists. Do not issue another reversal.
       * Discovery by the deterministic reversal identity remains authoritative.
       */
      this._logError(
        'Reversal posted but idempotency completion failed.',
        error,
        {
          tenantId:
            request.tenantId,

          originalJournalId:
            original.journal.id,

          reversalJournalId:
            result.journalId,

          operationId:
            request.operationId,
        },
      );
    }

    await this._publishEventSafe(
      'LedgerJournalReversed',
      finalResult,
      request,
    );

    await this._recordAuditSafe(
      'LEDGER_REVERSAL_COMPLETED',
      {
        tenantId:
          request.tenantId,

        originalJournalId:
          original.journal.id,

        reversalJournalId:
          result.journalId,

        reasonCode:
          request.reasonCode,

        transactionId:
          request.transactionId ||
          original.journal.transactionId ||
          null,
      },
    );

    this._metric(
      'ledger_reversal_completed_total',
      1,
      {
        reasonCode:
          request.reasonCode,
      },
    );

    return finalResult;
  }

  /**
   * Explicit alias.
   */
  async reverseJournal(
    input = {},
  ) {
    return this.reverse(
      input,
    );
  }

  /**
   * Resolve a transaction ID to its authoritative journal and reverse it.
   */
  async reverseTransaction(
    input = {},
  ) {
    const request =
      this._normalizeRequest(
        input,
      );

    if (
      !request.transactionId
      &&
      !request.journalId
    ) {
      throw new ReversalServiceError(
        'journalId or transactionId is required for reversal.',
        {
          code:
            REVERSAL_ERROR_CODES
              .JOURNAL_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.journalId
    ) {
      return this.reverse(
        request,
      );
    }

    const journal =
      await this._findJournalByTransactionId(
        request.transactionId,
        request.tenantId,
      );

    if (
      !journal
    ) {
      throw new ReversalServiceError(
        'No ledger journal was found for the transaction.',
        {
          code:
            REVERSAL_ERROR_CODES
              .TRANSACTION_NOT_FOUND,

          statusCode:
            404,

          tenantId:
            request.tenantId,

          transactionId:
            request.transactionId,
        },
      );
    }

    return this.reverse({
      ...request,

      journalId:
        safeId(
          journal._id ||
            journal.id,
        ),
    });
  }

  /**
   * Preview a reversal without creating any financial records.
   */
  async preview(
    input = {},
  ) {
    const request =
      this._normalizeRequest(
        input,
      );

    this._validateRequest(
      request,
      {
        allowIdempotencyMissing:
          true,
      },
    );

    const original =
      await this._loadOriginalJournal(
        request,
      );

    this._validateOriginalJournal(
      original,
      request,
    );

    const reversalEntries =
      this._buildReversalEntries(
        original.entries,
        original.journal,
      );

    this._validateReversalEntries(
      original,
      reversalEntries,
      request,
    );

    const command =
      this._buildReversalCommand(
        request,
        original,
        reversalEntries,
      );

    return {
      valid:
        true,

      status:
        REVERSAL_STATUS.READY,

      operationId:
        request.operationId ||
        createReversalOperationId(),

      tenantId:
        request.tenantId,

      originalJournalId:
        original.journal.id,

      originalPostingReference:
        original.journal.postingReference,

      originalStatus:
        original.journal.status,

      reversalReasonCode:
        request.reasonCode,

      reversalReference:
        command.reference,

      currency:
        original.journal.currency,

      entries:
        command.entries,

      totalDebit:
        command.totalDebit,

      totalCredit:
        command.totalCredit,

      description:
        command.description,

      fingerprint:
        command.reversalFingerprint,
    };
  }

  /* ==========================================================================
   * Original Journal Loading
   * ======================================================================== */

  async _loadOriginalJournal(
    request,
  ) {
    const journalId =
      request.journalId ||
      request.originalJournalId;

    if (
      journalId
    ) {
      return this._loadJournalAggregate(
        journalId,
        request.tenantId,
      );
    }

    if (
      request.transactionId &&
      this.options
        .allowTransactionLookup
    ) {
      const journal =
        await this._findJournalByTransactionId(
          request.transactionId,
          request.tenantId,
        );

      if (
        !journal
      ) {
        throw new ReversalServiceError(
          'No journal exists for the transaction.',
          {
            code:
              REVERSAL_ERROR_CODES
                .TRANSACTION_NOT_FOUND,

            statusCode:
              404,

            tenantId:
              request.tenantId,

            transactionId:
              request.transactionId,
          },
        );
      }

      return this._loadJournalAggregate(
        safeId(
          journal._id ||
            journal.id,
        ),
        request.tenantId,
      );
    }

    throw new ReversalServiceError(
      'Original journal ID is required.',
      {
        code:
          REVERSAL_ERROR_CODES
            .JOURNAL_REQUIRED,

        statusCode:
          400,

        tenantId:
          request.tenantId,
      },
    );
  }

  async _loadJournalAggregate(
    journalId,
    tenantId,
  ) {
    if (
      !this.journalRepository
    ) {
      throw new ReversalServiceError(
        'Journal repository is unavailable.',
        {
          code:
            REVERSAL_ERROR_CODES
              .REPOSITORY_REQUIRED,

          statusCode:
            503,

          tenantId,

          journalId,
        },
      );
    }

    let result =
      null;

    if (
      typeof this.journalRepository
        .findAggregateById ===
      'function'
    ) {
      result =
        await this.journalRepository
          .findAggregateById(
            journalId,
            {
              tenantId,
            },
          );
    } else if (
      typeof this.journalRepository
        .findById ===
      'function'
    ) {
      result =
        await this.journalRepository
          .findById(
            journalId,
            {
              tenantId,
            },
          );
    } else if (
      typeof this.journalRepository
        .getById ===
      'function'
    ) {
      result =
        await this.journalRepository
          .getById(
            journalId,
            {
              tenantId,
            },
          );
    } else {
      throw new ReversalServiceError(
        'Journal repository does not support journal lookup.',
        {
          code:
            REVERSAL_ERROR_CODES
              .REPOSITORY_REQUIRED,

          statusCode:
            500,

          tenantId,
        },
      );
    }

    if (
      !result
    ) {
      throw new ReversalServiceError(
        'Original journal was not found.',
        {
          code:
            REVERSAL_ERROR_CODES
              .JOURNAL_NOT_FOUND,

          statusCode:
            404,

          tenantId,

          journalId,
        },
      );
    }

    const journal =
      this._normalizeJournal(
        result.journal ||
          result,
      );

    const entries =
      result.entries ||
      await this._loadJournalEntries(
        journal.id,
        tenantId,
      );

    return {
      journal,

      entries:
        entries.map(
          this._normalizeEntry.bind(
            this,
          ),
        ),
    };
  }

  async _loadJournalEntries(
    journalId,
    tenantId,
  ) {
    if (
      !this.journalEntryRepository
    ) {
      if (
        this.options
          .requireOriginalEntries
      ) {
        throw new ReversalServiceError(
          'Journal entry repository is unavailable.',
          {
            code:
              REVERSAL_ERROR_CODES
                .REPOSITORY_REQUIRED,

            statusCode:
              503,

            tenantId,

            journalId,
          },
        );
      }

      return [];
    }

    if (
      typeof this.journalEntryRepository
        .findByJournalId ===
      'function'
    ) {
      const entries =
        await this.journalEntryRepository
          .findByJournalId(
            journalId,
            {
              tenantId,
            },
          );

      return Array.isArray(
        entries,
      )
        ? entries
        : [];
    }

    if (
      typeof this.journalEntryRepository
        .find ===
      'function'
    ) {
      const entries =
        await this.journalEntryRepository
          .find(
            {
              journalId,
              tenantId,
            },
          );

      return Array.isArray(
        entries,
      )
        ? entries
        : [];
    }

    throw new ReversalServiceError(
      'Journal entry repository does not support entry lookup.',
      {
        code:
          REVERSAL_ERROR_CODES
            .REPOSITORY_REQUIRED,

        statusCode:
          500,

        tenantId,

        journalId,
      },
    );
  }

  async _findJournalByTransactionId(
    transactionId,
    tenantId,
  ) {
    if (
      !this.journalRepository
    ) {
      throw new ReversalServiceError(
        'Journal repository is unavailable.',
        {
          code:
            REVERSAL_ERROR_CODES
              .REPOSITORY_REQUIRED,

          statusCode:
            503,

          tenantId,
        },
      );
    }

    if (
      typeof this.journalRepository
        .findByTransactionId ===
      'function'
    ) {
      return this.journalRepository
        .findByTransactionId(
          transactionId,
          {
            tenantId,
          },
        );
    }

    if (
      typeof this.journalRepository
        .findOne ===
      'function'
    ) {
      return this.journalRepository
        .findOne(
          {
            tenantId,

            transactionId,
          },
          {
            sort: {
              createdAt:
                -1,
            },
          },
        );
    }

    return null;
  }

  /* ==========================================================================
   * Original Journal Validation
   * ======================================================================== */

  _validateOriginalJournal(
    aggregate,
    request,
  ) {
    const journal =
      aggregate?.journal;

    const entries =
      aggregate?.entries ||
      [];

    if (
      !journal
    ) {
      throw new ReversalServiceError(
        'Original journal was not found.',
        {
          code:
            REVERSAL_ERROR_CODES
              .JOURNAL_NOT_FOUND,

          statusCode:
            404,

          tenantId:
            request.tenantId,

          originalJournalId:
            request.journalId ||
            request.originalJournalId,
        },
      );
    }

    if (
      this.options.requireTenant
      &&
      journal.tenantId
      &&
      journal.tenantId !==
        request.tenantId
    ) {
      throw new ReversalServiceError(
        'Original journal belongs to another tenant.',
        {
          code:
            REVERSAL_ERROR_CODES
              .TENANT_MISMATCH,

          statusCode:
            403,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,
        },
      );
    }

    if (
      this.options.onlyPostedJournals
      &&
      normalizeStatus(
        journal.status,
      ) !==
        JOURNAL_STATUS.POSTED
    ) {
      throw new ReversalServiceError(
        'Only POSTED journals may be reversed.',
        {
          code:
            REVERSAL_ERROR_CODES
              .JOURNAL_NOT_POSTED,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,
        },
      );
    }

    if (
      this.options
        .prohibitMultipleReversals
      &&
      journal.reversalJournalId
    ) {
      throw new ReversalServiceError(
        'The journal has already been reversed.',
        {
          code:
            REVERSAL_ERROR_CODES
              .ALREADY_REVERSED,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,

          reversalJournalId:
            journal.reversalJournalId,
        },
      );
    }

    if (
      this.options
        .prohibitMultipleReversals
      &&
      journal.reversedByJournalId
    ) {
      throw new ReversalServiceError(
        'The journal already has a reversal relationship.',
        {
          code:
            REVERSAL_ERROR_CODES
              .ALREADY_REVERSED,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,

          reversalJournalId:
            journal.reversedByJournalId,
        },
      );
    }

    if (
      request.journalId
      &&
      request.journalId ===
        journal.reversalJournalId
    ) {
      throw new ReversalServiceError(
        'A reversal journal cannot reverse itself.',
        {
          code:
            REVERSAL_ERROR_CODES
              .SELF_REVERSAL,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,
        },
      );
    }

    if (
      this.options
        .requireOriginalEntries
      &&
      entries.length <
        2
    ) {
      throw new ReversalServiceError(
        'Original journal does not contain enough entries to reverse.',
        {
          code:
            REVERSAL_ERROR_CODES
              .ENTRY_MISMATCH,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,
        },
      );
    }

    if (
      this.options
        .requireBalancedOriginal
    ) {
      this._assertJournalBalanced(
        journal,
        entries,
        request,
      );
    }

    if (
      request.currency
      &&
      normalizeCurrency(
        request.currency,
      ) !==
        normalizeCurrency(
          journal.currency,
        )
    ) {
      throw new ReversalServiceError(
        'Reversal currency does not match the original journal currency.',
        {
          code:
            REVERSAL_ERROR_CODES
              .CURRENCY_MISMATCH,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,
        },
      );
    }

    if (
      request.journalId
      &&
      request.journalId ===
        request.reversalJournalId
    ) {
      throw new ReversalServiceError(
        'A journal cannot reverse itself.',
        {
          code:
            REVERSAL_ERROR_CODES
              .SELF_REVERSAL,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,
        },
      );
    }
  }

  _assertJournalBalanced(
    journal,
    entries,
    request,
  ) {
    const debitEntries =
      entries.filter(
        (
          entry,
        ) =>
          entry.entryType ===
          ENTRY_TYPE.DEBIT,
      );

    const creditEntries =
      entries.filter(
        (
          entry,
        ) =>
          entry.entryType ===
          ENTRY_TYPE.CREDIT,
      );

    if (
      !debitEntries.length
    ) {
      throw new ReversalServiceError(
        'Original journal has no debit entries.',
        {
          code:
            REVERSAL_ERROR_CODES
              .BALANCE_MISMATCH,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,
        },
      );
    }

    if (
      !creditEntries.length
    ) {
      throw new ReversalServiceError(
        'Original journal has no credit entries.',
        {
          code:
            REVERSAL_ERROR_CODES
              .BALANCE_MISMATCH,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            journal.id,
        },
      );
    }

    if (
      journal.totalDebit !=
      null
      &&
      journal.totalCredit !=
      null
    ) {
      if (
        String(
          journal.totalDebit,
        ) !==
        String(
          journal.totalCredit,
        )
      ) {
        throw new ReversalServiceError(
          'Original journal totals are not balanced.',
          {
            code:
              REVERSAL_ERROR_CODES
                .BALANCE_MISMATCH,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              journal.id,

            details: {
              totalDebit:
                journal.totalDebit,

              totalCredit:
                journal.totalCredit,
            },
          },
        );
      }
    }
  }

  /* ==========================================================================
   * Reversal Entry Construction
   * ======================================================================== */

  _buildReversalEntries(
    originalEntries,
    originalJournal,
  ) {
    return originalEntries.map(
      (
        entry,
        index,
      ) => ({
        accountId:
          normalizeAccountId(
            entry.accountId,
          ),

        entryType:
          entry.entryType ===
          ENTRY_TYPE.DEBIT
            ? ENTRY_TYPE.CREDIT
            : ENTRY_TYPE.DEBIT,

        type:
          entry.entryType ===
          ENTRY_TYPE.DEBIT
            ? ENTRY_TYPE.CREDIT
            : ENTRY_TYPE.DEBIT,

        amount:
          entry.amount,

        currency:
          normalizeCurrency(
            entry.currency ||
              originalJournal.currency,
          ),

        description:
          `Reversal of ${
            originalJournal.postingReference ||
            originalJournal.id
          } entry ${entry.sequence || index + 1}`,

        reference:
          null,

        sequence:
          index + 1,

        metadata:
          {
            reversalOfJournalId:
              originalJournal.id,

            reversalOfEntryId:
              entry.id ||
              null,

            originalEntryType:
              entry.entryType,

            originalSequence:
              entry.sequence ||
              index + 1,
          },
      }),
    );
  }

  _validateReversalEntries(
    original,
    reversalEntries,
    request,
  ) {
    if (
      !reversalEntries.length
    ) {
      throw new ReversalServiceError(
        'No reversal entries could be generated.',
        {
          code:
            REVERSAL_ERROR_CODES
              .ENTRY_MISMATCH,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            original.journal.id,
        },
      );
    }

    const originalAccounts =
      original.entries.map(
        (
          entry,
        ) =>
          normalizeAccountId(
            entry.accountId,
          ),
      );

    const reversalAccounts =
      reversalEntries.map(
        (
          entry,
        ) =>
          normalizeAccountId(
            entry.accountId,
          ),
      );

    if (
      originalAccounts.length !==
      reversalAccounts.length
    ) {
      throw new ReversalServiceError(
        'Reversal entry count does not match the original journal.',
        {
          code:
            REVERSAL_ERROR_CODES
              .ENTRY_MISMATCH,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            original.journal.id,
        },
      );
    }

    for (
      let index = 0;
      index <
        original.entries.length;
      index +=
        1
    ) {
      const source =
        original.entries[
          index
        ];

      const reversal =
        reversalEntries[
          index
        ];

      if (
        normalizeAccountId(
          source.accountId,
        ) !==
        normalizeAccountId(
          reversal.accountId,
        )
      ) {
        throw new ReversalServiceError(
          'Reversal account mapping does not match the original entry.',
          {
            code:
              REVERSAL_ERROR_CODES
                .ENTRY_MISMATCH,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,

            details: {
              sequence:
                index + 1,
            },
          },
        );
      }

      if (
        source.entryType ===
        reversal.entryType
      ) {
        throw new ReversalServiceError(
          'Reversal entry type must be the exact inverse of the original entry type.',
          {
            code:
              REVERSAL_ERROR_CODES
                .ENTRY_MISMATCH,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,

            details: {
              sequence:
                index + 1,

              sourceType:
                source.entryType,

              reversalType:
                reversal.entryType,
            },
          },
        );
      }

      if (
        String(
          source.amount,
        ) !==
        String(
          reversal.amount,
        )
      ) {
        throw new ReversalServiceError(
          'Reversal entry amount must exactly match the original entry amount.',
          {
            code:
              REVERSAL_ERROR_CODES
                .ENTRY_MISMATCH,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,

            details: {
              sequence:
                index + 1,

              sourceAmount:
                source.amount,

              reversalAmount:
                reversal.amount,
            },
          },
        );
      }

      if (
        normalizeCurrency(
          source.currency,
        ) !==
        normalizeCurrency(
          reversal.currency,
        )
      ) {
        throw new ReversalServiceError(
          'Reversal entry currency must match the original entry currency.',
          {
            code:
              REVERSAL_ERROR_CODES
                .CURRENCY_MISMATCH,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,
          },
        );
      }
    }

    /**
     * Because every original entry is inverted one-for-one, the reversal must
     * also balance. Explicitly validate the totals to catch corrupt historical
     * records before creating a compensating journal.
     */
    const originalDebitTotal =
      this._sumEntryAmounts(
        original.entries.filter(
          (
            entry,
          ) =>
            entry.entryType ===
            ENTRY_TYPE.DEBIT,
        ),
      );

    const originalCreditTotal =
      this._sumEntryAmounts(
        original.entries.filter(
          (
            entry,
          ) =>
            entry.entryType ===
            ENTRY_TYPE.CREDIT,
        ),
      );

    const reversalDebitTotal =
      this._sumEntryAmounts(
        reversalEntries.filter(
          (
            entry,
          ) =>
            entry.entryType ===
            ENTRY_TYPE.DEBIT,
        ),
      );

    const reversalCreditTotal =
      this._sumEntryAmounts(
        reversalEntries.filter(
          (
            entry,
          ) =>
            entry.entryType ===
            ENTRY_TYPE.CREDIT,
        ),
      );

    if (
      originalDebitTotal !==
      originalCreditTotal
    ) {
      throw new ReversalServiceError(
        'Original journal is financially unbalanced and cannot be reversed automatically.',
        {
          code:
            REVERSAL_ERROR_CODES
              .BALANCE_MISMATCH,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          originalJournalId:
            original.journal.id,

          details: {
            originalDebitTotal,
            originalCreditTotal,
          },
        },
      );
    }

    if (
      reversalDebitTotal !==
      reversalCreditTotal
    ) {
      throw new ReversalServiceError(
        'Generated reversal journal is not balanced.',
        {
          code:
            REVERSAL_ERROR_CODES
              .BALANCE_MISMATCH,

          statusCode:
            500,

          tenantId:
            request.tenantId,

          originalJournalId:
            original.journal.id,

          details: {
            reversalDebitTotal,
            reversalCreditTotal,
          },
        },
      );
    }
  }

  _sumEntryAmounts(
    entries,
  ) {
    const scale =
      2;

    let total =
      0n;

    for (
      const entry of
        entries
    ) {
      const raw =
        String(
          entry.amount,
        );

      if (
        !/^\d+(\.\d+)?$/.test(
          raw,
        )
      ) {
        return null;
      }

      const [
        integerPart,
        fractionPart = '',
      ] =
        raw.split('.');

      if (
        fractionPart.length >
        scale
      ) {
        return null;
      }

      total +=
        BigInt(
          integerPart,
        ) *
          100n +
        BigInt(
          fractionPart.padEnd(
            scale,
            '0',
          ) ||
            '0',
        );
    }

    return total;
  }

  /* ==========================================================================
   * Reversal Command
   * ======================================================================== */

  _buildReversalCommand(
    request,
    original,
    entries,
  ) {
    const originalJournal =
      original.journal;

    const reference =
      request.reference ||
      createReversalReference();

    const description =
      request.description ||
      `Reversal of journal ${
        originalJournal.postingReference ||
        originalJournal.id
      }: ${
        request.reasonCode
      }`;

    const totalDebit =
      this._calculateTotal(
        entries.filter(
          (
            entry,
          ) =>
            entry.entryType ===
            ENTRY_TYPE.DEBIT,
        ),
      );

    const totalCredit =
      this._calculateTotal(
        entries.filter(
          (
            entry,
          ) =>
            entry.entryType ===
            ENTRY_TYPE.CREDIT,
        ),
      );

    const reversalFingerprint =
      sha256({
        tenantId:
          request.tenantId,

        originalJournalId:
          originalJournal.id,

        originalJournalFingerprint:
          originalJournal
            .payloadFingerprint ||
          originalJournal
            .postingFingerprint ||
          null,

        reasonCode:
          request.reasonCode,

        entries:
          entries.map(
            (
              entry,
            ) => ({
              accountId:
                entry.accountId,

              entryType:
                entry.entryType,

              amount:
                entry.amount,

              currency:
                entry.currency,
            }),
          ),
      });

    return {
      operationId:
        request.operationId,

      tenantId:
        request.tenantId,

      operationType:
        'REVERSAL',

      idempotencyKey:
        request.idempotencyKey,

      transactionId:
        request.transactionId ||
        originalJournal.transactionId ||
        null,

      originalJournalId:
        originalJournal.id,

      currency:
        originalJournal.currency,

      accountingDate:
        request.accountingDate ||
        originalJournal.accountingDate,

      description,

      reference,

      source:
        'REVERSAL',

      sourceId:
        originalJournal.id,

      reversalOfJournalId:
        originalJournal.id,

      reasonCode:
        request.reasonCode,

      entries,

      totalDebit,

      totalCredit,

      reversalFingerprint,

      metadata:
        this._sanitizeMetadata(
          {
            ...request.metadata,

            originalJournalId:
              originalJournal.id,

            originalPostingReference:
              originalJournal
                .postingReference,

            reversalReasonCode:
              request.reasonCode,
          },
        ),
    };
  }

  _calculateTotal(
    entries,
  ) {
    let total =
      0;

    for (
      const entry of
        entries
    ) {
      const numeric =
        Number(
          entry.amount,
        );

      if (
        !Number.isFinite(
          numeric,
        )
      ) {
        return null;
      }

      total +=
        numeric;
    }

    return total.toFixed(
      2,
    ).replace(
      /\.00$/,
      '',
    );
  }

  /* ==========================================================================
   * Existing Reversal Detection
   * ======================================================================== */

  async _findExistingReversal(
    request,
    original,
  ) {
    const originalId =
      original.journal.id;

    /**
     * Strongest lookup: explicit original->reversal link.
     */
    if (
      original.journal
        .reversalJournalId
    ) {
      const aggregate =
        await this._loadJournalAggregate(
          original.journal
            .reversalJournalId,
          request.tenantId,
        );

      return {
        journal:
          aggregate.journal,

        entries:
          aggregate.entries,

        replay:
          true,
      };
    }

    /**
     * Repository-level lookup for reversal relationship.
     */
    if (
      this.journalRepository
      &&
      typeof this.journalRepository
        .findReversalByOriginalJournalId ===
      'function'
    ) {
      const reversal =
        await this.journalRepository
          .findReversalByOriginalJournalId(
            originalId,
            {
              tenantId:
                request.tenantId,
            },
          );

      if (
        reversal
      ) {
        const aggregate =
          await this._loadJournalAggregate(
            safeId(
              reversal._id ||
                reversal.id,
            ),
            request.tenantId,
          );

        return {
          journal:
            aggregate.journal,

          entries:
            aggregate.entries,

          replay:
            true,
        };
      }
    }

    /**
     * Deterministic reversal idempotency lookup.
     */
    if (
      this.idempotencyService
      &&
      request.idempotencyKey
    ) {
      const existing =
        await this._findExistingIdempotency(
          request,
        );

      if (
        existing
      ) {
        return existing;
      }
    }

    return null;
  }

  async _findExistingIdempotency(
    request,
  ) {
    if (
      !this.idempotencyService
    ) {
      return null;
    }

    const lookup = {
      tenantId:
        request.tenantId,

      operationType:
        'REVERSAL',

      key:
        request.idempotencyKey,
    };

    if (
      typeof this.idempotencyService
        .getExisting ===
      'function'
    ) {
      const existing =
        await this.idempotencyService
          .getExisting(
            lookup,
          );

      if (
        existing?.completed
        && existing.result
      ) {
        return {
          result:
            existing.result,

          replay:
            true,
        };
      }

      if (
        existing?.status ===
        'UNKNOWN'
      ) {
        throw new ReversalServiceError(
          'Reversal operation has an unknown outcome and requires reconciliation.',
          {
            code:
              REVERSAL_ERROR_CODES
                .UNKNOWN_OUTCOME,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            idempotencyKey:
              request.idempotencyKey,

            unknownOutcome:
              true,

            reconciliationRequired:
              true,
          },
        );
      }

      if (
        existing?.inProgress
      ) {
        throw new ReversalServiceError(
          'Reversal operation is already being processed.',
          {
            code:
              REVERSAL_ERROR_CODES
                .PROCESSING_CONFLICT,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            idempotencyKey:
              request.idempotencyKey,
          },
        );
      }
    }

    if (
      typeof this.idempotencyService
        .getByKey ===
      'function'
    ) {
      try {
        const existing =
          await this.idempotencyService
            .getByKey(
              lookup,
            );

        if (
          existing?.completed
          && existing.result
        ) {
          return {
            result:
              existing.result,

            replay:
              true,
          };
        }

        if (
          existing?.status ===
          'UNKNOWN'
        ) {
          throw new ReversalServiceError(
            'Reversal operation has an unknown outcome and requires reconciliation.',
            {
              code:
                REVERSAL_ERROR_CODES
                  .UNKNOWN_OUTCOME,

              statusCode:
                409,

              tenantId:
                request.tenantId,

              idempotencyKey:
                request.idempotencyKey,

              unknownOutcome:
                true,

              reconciliationRequired:
                true,
            },
          );
        }
      } catch (error) {
        if (
          error instanceof
          ReversalServiceError
        ) {
          throw error;
        }

        if (
          error?.code !==
          'TRANSACTION_IDEMPOTENCY_NOT_FOUND'
        ) {
          throw error;
        }
      }
    }

    return null;
  }

  /* ==========================================================================
   * Idempotency Reservation
   * ======================================================================== */

  async _reserveIdempotency(
    request,
    original,
    command,
  ) {
    if (
      !this.idempotencyService
    ) {
      if (
        this.options
          .requireIdempotency
        &&
        this.options.strictMode
      ) {
        throw new ReversalServiceError(
          'Idempotency service is required for production reversals.',
          {
            code:
              REVERSAL_ERROR_CODES
                .CONFIGURATION_ERROR,

            statusCode:
              500,

            tenantId:
              request.tenantId,
          },
        );
      }

      return {
        operationId:
          request.operationId,

        completed:
          false,
      };
    }

    return this.idempotencyService.reserve(
      {
        tenantId:
          request.tenantId,

        operationType:
          'REVERSAL',

        key:
          request.idempotencyKey,

        operationId:
          request.operationId,

        transactionId:
          request.transactionId ||
          original.journal
            .transactionId,

        request: {
          originalJournalId:
            original.journal.id,

          originalPostingReference:
            original.journal
              .postingReference,

          reasonCode:
            request.reasonCode,

          currency:
            command.currency,

          accountingDate:
            command.accountingDate,

          reversalFingerprint:
            command.reversalFingerprint,

          entries:
            command.entries.map(
              (
                entry,
              ) => ({
                accountId:
                  entry.accountId,

                entryType:
                  entry.entryType,

                amount:
                  entry.amount,

                currency:
                  entry.currency,
              }),
            ),
        },

        metadata:
          this._sanitizeMetadata(
            command.metadata,
          ),
      },
    );
  }

  async _completeIdempotency(
    operation,
    result,
    request,
  ) {
    if (
      !this.idempotencyService
      ||
      !operation?.operationId
    ) {
      return null;
    }

    return this.idempotencyService.complete(
      operation.operationId,
      result,
      {
        tenantId:
          request.tenantId,
      },
    );
  }

  async _markUnknownSafe(
    operation,
    request,
    error,
  ) {
    if (
      !this.idempotencyService
      ||
      !operation?.operationId
    ) {
      return null;
    }

    try {
      return await this.idempotencyService
        .markUnknown(
          operation.operationId,
          {
            tenantId:
              request.tenantId,

            reasonCode:
              REVERSAL_ERROR_CODES
                .RECONCILIATION_REQUIRED,

            reason:
              error?.message,

            metadata: {
              originalJournalId:
                request.journalId ||
                request.originalJournalId,
            },
          },
        );
    } catch (idempotencyError) {
      this._logError(
        'Failed to mark reversal idempotency state UNKNOWN.',
        idempotencyError,
        {
          tenantId:
            request.tenantId,

          operationId:
            operation.operationId,
        },
      );

      return null;
    }
  }

  async _handleFailure(
    request,
    operation,
    error,
  ) {
    if (
      !this.idempotencyService
      ||
      !operation?.operationId
    ) {
      return null;
    }

    try {
      if (
        error?.unknownOutcome ===
        true
      ) {
        return this.idempotencyService
          .markUnknown(
            operation.operationId,
            {
              tenantId:
                request.tenantId,

              reasonCode:
                error.code ||
                REVERSAL_ERROR_CODES
                  .UNKNOWN_OUTCOME,

              reason:
                error.message,
            },
          );
      }

      return this.idempotencyService
        .fail(
          operation.operationId,
          error,
          {
            tenantId:
              request.tenantId,

            retryable:
              error?.retryable ===
              true,
          },
        );
    } catch (idempotencyError) {
      this._logError(
        'Failed to persist reversal idempotency failure state.',
        idempotencyError,
        {
          tenantId:
            request.tenantId,

          operationId:
            operation.operationId,
        },
      );

      return null;
    }
  }

  /* ==========================================================================
   * Reversal Execution
   * ======================================================================== */

  async _executeReversal(
    request,
    original,
    command,
  ) {
    /**
     * Preferred path: PostingEngine.
     */
    if (
      this.postingEngine
    ) {
      return this._executeThroughPostingEngine(
        request,
        original,
        command,
      );
    }

    /**
     * Compatibility path: LedgerEngine.
     */
    if (
      this.ledgerEngine
    ) {
      return this._executeThroughLedgerEngine(
        request,
        original,
        command,
      );
    }

    throw new ReversalServiceError(
      'PostingEngine or LedgerEngine is required to execute a reversal.',
      {
        code:
          REVERSAL_ERROR_CODES
            .POSTING_ENGINE_REQUIRED,

        statusCode:
          500,

        tenantId:
          request.tenantId,
      },
    );
  }

  async _executeThroughPostingEngine(
    request,
    original,
    command,
  ) {
    if (
      typeof this.postingEngine
        .post !==
      'function'
    ) {
      throw new ReversalServiceError(
        'PostingEngine does not expose post().',
        {
          code:
            REVERSAL_ERROR_CODES
              .POSTING_ENGINE_REQUIRED,

          statusCode:
            500,

          tenantId:
            request.tenantId,
        },
      );
    }

    const result =
      await this.postingEngine
        .post(
          {
            operationId:
              request.operationId,

            tenantId:
              request.tenantId,

            operationType:
              'REVERSAL',

            idempotencyKey:
              request.idempotencyKey,

            transactionId:
              request.transactionId ||
              original.journal
                .transactionId,

            currency:
              command.currency,

            accountingDate:
              command.accountingDate,

            description:
              command.description,

            reference:
              command.reference,

            source:
              'REVERSAL',

            sourceId:
              original.journal.id,

            reversalOfJournalId:
              original.journal.id,

            reasonCode:
              request.reasonCode,

            correlationId:
              request.correlationId,

            causationId:
              request.causationId,

            metadata:
              command.metadata,

            entries:
              command.entries,
          },
        );

    return this._normalizePostingResult(
      result,
      command,
    );
  }

  async _executeThroughLedgerEngine(
    request,
    original,
    command,
  ) {
    if (
      typeof this.ledgerEngine
        .post ===
      'function'
    ) {
      const result =
        await this.ledgerEngine
          .post(
            {
              operationId:
                request.operationId,

              tenantId:
                request.tenantId,

              operationType:
                'REVERSAL',

              idempotencyKey:
                request.idempotencyKey,

              transactionId:
                request.transactionId ||
                original.journal
                  .transactionId,

              currency:
                command.currency,

              accountingDate:
                command.accountingDate,

              description:
                command.description,

              reference:
                command.reference,

              source:
                'REVERSAL',

              sourceId:
                original.journal.id,

              reversalOfJournalId:
                original.journal.id,

              reasonCode:
                request.reasonCode,

              metadata:
                command.metadata,

              entries:
                command.entries,
            },
          );

      return this._normalizePostingResult(
        result,
        command,
      );
    }

    throw new ReversalServiceError(
      'LedgerEngine does not expose post().',
      {
        code:
          REVERSAL_ERROR_CODES
            .LEDGER_ENGINE_REQUIRED,

        statusCode:
          500,

        tenantId:
          request.tenantId,
      },
    );
  }

  _normalizePostingResult(
    result,
    command,
  ) {
    const value =
      result &&
      typeof result ===
        'object'
        ? result
        : {};

    return {
      success:
        value.success !==
          false,

      journalId:
        safeId(
          value.journalId ||
          value.journal?.id ||
          value.journal?._id,
        ),

      postingReference:
        normalizeString(
          value.postingReference ||
          value.journal
            ?.postingReference,
        ) ||
        command.reference,

      transactionId:
        safeId(
          value.transactionId ||
          command.transactionId,
        ),

      tenantId:
        value.tenantId ||
        command.tenantId,

      operationType:
        value.operationType ||
        'REVERSAL',

      status:
        normalizeStatus(
          value.status ||
          value.journal?.status,
        ) ||
        JOURNAL_STATUS.POSTED,

      currency:
        normalizeCurrency(
          value.currency ||
          value.journal?.currency ||
          command.currency,
        ),

      accountingDate:
        value.accountingDate ||
        value.journal
          ?.accountingDate ||
        command.accountingDate,

      totalDebit:
        value.totalDebit ||
        value.journal?.totalDebit ||
        command.totalDebit,

      totalCredit:
        value.totalCredit ||
        value.journal?.totalCredit ||
        command.totalCredit,

      entryCount:
        Number(
          value.entryCount ||
          value.entries?.length ||
          command.entries.length,
        ),

      entries:
        Array.isArray(
          value.entries,
        )
          ? value.entries
          : command.entries,

      reversalOfJournalId:
        safeId(
          value.reversalOfJournalId ||
          value.journal
            ?.reversalOfJournalId ||
          command.originalJournalId,
        ),

      metadata:
        this._sanitizeMetadata(
          value.metadata ||
          {},
        ),

      createdAt:
        value.createdAt ||
        null,

      postedAt:
        value.postedAt ||
        null,
    };
  }

  /* ==========================================================================
   * Original/Reverse Linkage
   * ======================================================================== */

  async _linkOriginalToReversal(
    original,
    result,
    request,
  ) {
    if (
      !this.journalRepository
    ) {
      throw new ReversalServiceError(
        'Journal repository is required to link reversal relationship.',
        {
          code:
            REVERSAL_ERROR_CODES
              .REPOSITORY_REQUIRED,

          statusCode:
            503,

          tenantId:
            request.tenantId,

          originalJournalId:
            original.journal.id,

          reversalJournalId:
            result.journalId,
        },
      );
    }

    const patch = {
      status:
        JOURNAL_STATUS.REVERSED,

      reversalJournalId:
        result.journalId,

      reversedAt:
        now(),

      reversalReasonCode:
        request.reasonCode,

      updatedAt:
        now(),
    };

    if (
      typeof this.journalRepository
        .markReversed ===
      'function'
    ) {
      const updated =
        await this.journalRepository
          .markReversed(
            original.journal.id,
            patch,
            {
              tenantId:
                request.tenantId,

              expectedVersion:
                Number(
                  original.journal.version ||
                    0,
                ),
            },
          );

      if (
        !updated
      ) {
        throw new ReversalServiceError(
          'Original journal could not be linked to the reversal.',
          {
            code:
              REVERSAL_ERROR_CODES
                .CONCURRENCY_CONFLICT,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,

            reversalJournalId:
              result.journalId,
          },
        );
      }

      return updated;
    }

    if (
      typeof this.journalRepository
        .updateWithVersion ===
      'function'
    ) {
      const updated =
        await this.journalRepository
          .updateWithVersion(
            original.journal.id,
            Number(
              original.journal.version ||
                0,
            ),
            {
              ...patch,

              version:
                Number(
                  original.journal
                    .version ||
                    0,
                ) + 1,
            },
            {
              tenantId:
                request.tenantId,
            },
          );

      if (
        !updated
      ) {
        throw new ReversalServiceError(
          'Original journal reversal linkage encountered a concurrent update.',
          {
            code:
              REVERSAL_ERROR_CODES
                .CONCURRENCY_CONFLICT,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,

            reversalJournalId:
              result.journalId,
          },
        );
      }

      return updated;
    }

    if (
      typeof this.journalRepository
        .update ===
      'function'
    ) {
      if (
        this.options.strictMode
      ) {
        throw new ReversalServiceError(
          'Atomic reversal linkage is required in strict mode.',
          {
            code:
              REVERSAL_ERROR_CODES
                .PERSISTENCE_ERROR,

            statusCode:
              500,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,
          },
        );
      }

      return this.journalRepository
        .update(
          original.journal.id,
          patch,
          {
            tenantId:
              request.tenantId,
          },
        );
    }

    throw new ReversalServiceError(
      'Journal repository does not support reversal linkage.',
      {
        code:
          REVERSAL_ERROR_CODES
            .REPOSITORY_REQUIRED,

        statusCode:
          500,

        tenantId:
          request.tenantId,

        originalJournalId:
          original.journal.id,

        reversalJournalId:
          result.journalId,
      },
    );
  }

  /* ==========================================================================
   * Accounting Period
   * ======================================================================== */

  async _validateAccountingPeriod(
    request,
    original,
  ) {
    if (
      !this.options
        .validateAccountingPeriod
      ||
      !this.periodCloseService
    ) {
      return true;
    }

    const date =
      parseDate(
        request.accountingDate ||
        original.journal
          .accountingDate,
      );

    if (
      !date
    ) {
      throw new ReversalServiceError(
        'Valid accounting date is required for reversal.',
        {
          code:
            REVERSAL_ERROR_CODES
              .INVALID_DATE,

          statusCode:
            400,

          tenantId:
            request.tenantId,

          originalJournalId:
            original.journal.id,
        },
      );
    }

    if (
      typeof this.periodCloseService
        .assertOpen ===
      'function'
    ) {
      const result =
        await this.periodCloseService
          .assertOpen(
            {
              tenantId:
                request.tenantId,

              accountingDate:
                date,

              operationType:
                'REVERSAL',
            },
          );

      if (
        result === false
      ) {
        throw new ReversalServiceError(
          'Accounting period is closed.',
          {
            code:
              REVERSAL_ERROR_CODES
                .PERIOD_CLOSED,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,
          },
        );
      }

      return true;
    }

    if (
      typeof this.periodCloseService
        .isClosed ===
      'function'
    ) {
      const closed =
        await this.periodCloseService
          .isClosed(
            {
              tenantId:
                request.tenantId,

              accountingDate:
                date,
            },
          );

      if (
        closed
      ) {
        throw new ReversalServiceError(
          'Accounting period is closed.',
          {
            code:
              REVERSAL_ERROR_CODES
                .PERIOD_CLOSED,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            originalJournalId:
              original.journal.id,
          },
        );
      }
    }

    return true;
  }

  /* ==========================================================================
   * Request Validation
   * ======================================================================== */

  _validateRequest(
    request,
    options = {},
  ) {
    if (
      this.options.requireTenant
      && !request.tenantId
    ) {
      throw new ReversalServiceError(
        'Tenant ID is required.',
        {
          code:
            REVERSAL_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,
        },
      );
    }

    if (
      !request.journalId
      &&
      !request.originalJournalId
      &&
      !request.transactionId
    ) {
      throw new ReversalServiceError(
        'journalId, originalJournalId, or transactionId is required.',
        {
          code:
            REVERSAL_ERROR_CODES
              .JOURNAL_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      this.options.requireIdempotency
      && !options.allowIdempotencyMissing
      && !request.idempotencyKey
    ) {
      throw new ReversalServiceError(
        'Idempotency key is required.',
        {
          code:
            REVERSAL_ERROR_CODES
              .IDEMPOTENCY_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      this.options.requireReasonCode
      && !request.reasonCode
    ) {
      throw new ReversalServiceError(
        'Reversal reason code is required.',
        {
          code:
            REVERSAL_ERROR_CODES
              .REASON_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.reasonCode
      &&
      !/^[A-Z][A-Z0-9_]{1,99}$/.test(
        request.reasonCode,
      )
    ) {
      throw new ReversalServiceError(
        'Invalid reversal reason code.',
        {
          code:
            REVERSAL_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,

          tenantId:
            request.tenantId,

          reasonCode:
            request.reasonCode,
        },
      );
    }

    if (
      request.accountingDate
      &&
      !parseDate(
        request.accountingDate,
      )
    ) {
      throw new ReversalServiceError(
        'Invalid reversal accounting date.',
        {
          code:
            REVERSAL_ERROR_CODES
              .INVALID_DATE,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.description
      &&
      request.description.length >
        this.options
          .maxDescriptionLength
    ) {
      throw new ReversalServiceError(
        'Reversal description is too long.',
        {
          code:
            REVERSAL_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.reference
      &&
      request.reference.length >
        this.options
          .maxReferenceLength
    ) {
      throw new ReversalServiceError(
        'Reversal reference is too long.',
        {
          code:
            REVERSAL_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    return true;
  }

  /* ==========================================================================
   * Result Construction
   * ======================================================================== */

  _buildResult(
    request,
    original,
    result,
    options = {},
  ) {
    return {
      success:
        result.success !== false,

      status:
        options.replay
          ? REVERSAL_STATUS.REPLAYED
          : REVERSAL_STATUS.COMPLETED,

      reversalJournalId:
        result.journalId,

      journalId:
        result.journalId,

      originalJournalId:
        original.journal.id,

      originalPostingReference:
        original.journal
          .postingReference,

      reversalPostingReference:
        result.postingReference,

      transactionId:
        request.transactionId ||
        original.journal
          .transactionId ||
        null,

      tenantId:
        request.tenantId,

      operationType:
        'REVERSAL',

      reasonCode:
        request.reasonCode,

      currency:
        result.currency ||
        original.journal.currency,

      accountingDate:
        result.accountingDate ||
        request.accountingDate ||
        original.journal
          .accountingDate,

      totalDebit:
        result.totalDebit,

      totalCredit:
        result.totalCredit,

      entryCount:
        result.entryCount,

      entries:
        result.entries,

      replay:
        options.replay ===
        true,

      immutableOriginal:
        true,

      originalJournalStatus:
        JOURNAL_STATUS.REVERSED,

      reversalOfJournalId:
        original.journal.id,

      operationId:
        request.operationId,

      idempotencyKey:
        request.idempotencyKey,

      createdAt:
        result.createdAt ||
        null,

      postedAt:
        result.postedAt ||
        null,
    };
  }

  _buildReplayResult(
    existing,
    original,
  ) {
    if (
      existing.result
    ) {
      return {
        ...clone(
          existing.result,
        ),

        success:
          true,

        status:
          REVERSAL_STATUS.REPLAYED,

        replay:
          true,

        originalJournalId:
          original.journal.id,
      };
    }

    if (
      existing.journal
    ) {
      return {
        success:
          true,

        status:
          REVERSAL_STATUS.REPLAYED,

        replay:
          true,

        reversalJournalId:
          existing.journal.id,

        journalId:
          existing.journal.id,

        originalJournalId:
          original.journal.id,

        originalPostingReference:
          original.journal
            .postingReference,

        reversalPostingReference:
          existing.journal
            .postingReference,

        transactionId:
          existing.journal
            .transactionId ||
          original.journal
            .transactionId ||
          null,

        tenantId:
          original.journal
            .tenantId,

        currency:
          existing.journal
            .currency ||
          original.journal
            .currency,

        totalDebit:
          existing.journal
            .totalDebit,

        totalCredit:
          existing.journal
            .totalCredit,
      };
    }

    return {
      success:
        true,

      status:
        REVERSAL_STATUS.REPLAYED,

      replay:
        true,

      originalJournalId:
        original.journal.id,
    };
  }

  /* ==========================================================================
   * Record Normalization
   * ======================================================================== */

  _normalizeJournal(
    journal,
  ) {
    const plain =
      journal &&
      typeof journal ===
        'object'
        ? (
            typeof journal.toObject ===
              'function'
              ? journal.toObject()
              : journal
          )
        : {};

    return {
      ...clone(
        plain,
      ),

      id:
        safeId(
          plain.id ||
            plain._id,
        ),

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      status:
        normalizeStatus(
          plain.status,
        ),

      operationType:
        normalizeStatus(
          plain.operationType ||
            plain.type,
        ),

      transactionId:
        safeId(
          plain.transactionId,
        ),

      postingReference:
        normalizeString(
          plain.postingReference ||
            plain.reference,
        ),

      currency:
        normalizeCurrency(
          plain.currency,
        ),

      accountingDate:
        plain.accountingDate ||
        null,

      totalDebit:
        normalizeString(
          plain.totalDebit,
        ),

      totalCredit:
        normalizeString(
          plain.totalCredit,
        ),

      reversalJournalId:
        safeId(
          plain.reversalJournalId,
        ),

      reversedByJournalId:
        safeId(
          plain.reversedByJournalId,
        ),

      reversalOfJournalId:
        safeId(
          plain.reversalOfJournalId,
        ),

      payloadFingerprint:
        normalizeString(
          plain.payloadFingerprint,
        ),

      postingFingerprint:
        normalizeString(
          plain.postingFingerprint,
        ),

      version:
        Number(
          plain.version ||
            0,
        ),

      createdAt:
        plain.createdAt ||
        null,

      postedAt:
        plain.postedAt ||
        null,

      updatedAt:
        plain.updatedAt ||
        null,
    };
  }

  _normalizeEntry(
    entry,
  ) {
    const plain =
      entry &&
      typeof entry ===
        'object'
        ? (
            typeof entry.toObject ===
              'function'
              ? entry.toObject()
              : entry
          )
        : {};

    return {
      ...clone(
        plain,
      ),

      id:
        safeId(
          plain.id ||
            plain._id,
        ),

      journalId:
        safeId(
          plain.journalId,
        ),

      accountId:
        normalizeAccountId(
          plain.accountId,
        ),

      entryType:
        normalizeStatus(
          plain.entryType ||
            plain.type,
        ),

      type:
        normalizeStatus(
          plain.entryType ||
            plain.type,
        ),

      amount:
        normalizeString(
          plain.amount,
        ),

      currency:
        normalizeCurrency(
          plain.currency,
        ),

      sequence:
        Number(
          plain.sequence ||
            0,
        ),
    };
  }

  /* ==========================================================================
   * Request Normalization
   * ======================================================================== */

  _normalizeRequest(
    input,
  ) {
    const value =
      input &&
      typeof input ===
        'object'
        ? input
        : {};

    return {
      operationId:
        safeId(
          value.operationId,
        ),

      tenantId:
        normalizeString(
          value.tenantId,
        ),

      journalId:
        safeId(
          value.journalId,
        ),

      originalJournalId:
        safeId(
          value.originalJournalId,
        ),

      transactionId:
        safeId(
          value.transactionId,
        ),

      reversalJournalId:
        safeId(
          value.reversalJournalId,
        ),

      idempotencyKey:
        normalizeString(
          value.idempotencyKey ||
          value.idempotency_key,
        ),

      reasonCode:
        normalizeStatus(
          value.reasonCode,
        ),

      description:
        normalizeString(
          value.description,
        ),

      reference:
        normalizeString(
          value.reference,
        ),

      accountingDate:
        value.accountingDate ||
        null,

      actorId:
        safeId(
          value.actorId ||
          value.createdBy ||
          value.initiatedBy,
        ),

      correlationId:
        normalizeString(
          value.correlationId,
        ),

      causationId:
        normalizeString(
          value.causationId,
        ),

      currency:
        normalizeCurrency(
          value.currency,
        ),

      metadata:
        this._sanitizeMetadata(
          value.metadata ||
          {},
        ),
    };
  }

  /* ==========================================================================
   * Events / Audit
   * ======================================================================== */

  async _publishEventSafe(
    eventType,
    result,
    request,
  ) {
    if (
      !this.options.publishEvents
      ||
      !this.eventPublisher
    ) {
      return null;
    }

    const event = {
      eventId:
        `evt_reversal_${crypto.randomUUID()}`,

      eventType,

      eventVersion:
        1,

      occurredAt:
        isoNow(),

      tenantId:
        request.tenantId,

      aggregateType:
        'Journal',

      aggregateId:
        result.reversalJournalId ||
        result.journalId ||
        null,

      correlationId:
        request.correlationId ||
        null,

      causationId:
        request.causationId ||
        null,

      operationId:
        request.operationId,

      data: {
        originalJournalId:
          result.originalJournalId,

        reversalJournalId:
          result.reversalJournalId ||
          result.journalId,

        originalPostingReference:
          result.originalPostingReference,

        reversalPostingReference:
          result.reversalPostingReference,

        transactionId:
          result.transactionId,

        reasonCode:
          result.reasonCode,

        currency:
          result.currency,

        totalDebit:
          result.totalDebit,

        totalCredit:
          result.totalCredit,
      },

      metadata:
        this._sanitizeMetadata(
          request.metadata,
        ),
    };

    event.eventFingerprint =
      sha256(
        {
          eventType,

          tenantId:
            request.tenantId,

          originalJournalId:
            result.originalJournalId,

          reversalJournalId:
            result.reversalJournalId ||
            result.journalId,
        },
      );

    try {
      if (
        typeof this.eventPublisher
          .publish ===
        'function'
      ) {
        return await this.eventPublisher
          .publish(
            event,
          );
      }

      if (
        typeof this.eventPublisher
          .publishEvent ===
        'function'
      ) {
        return await this.eventPublisher
          .publishEvent(
            event,
          );
      }

      if (
        typeof this.eventPublisher
          .emit ===
        'function'
      ) {
        return await this.eventPublisher.emit(
          eventType,
          event,
        );
      }
    } catch (error) {
      this._logError(
        'Reversal event publication failed.',
        error,
        {
          eventType,

          tenantId:
            request.tenantId,

          originalJournalId:
            result.originalJournalId,

          reversalJournalId:
            result.reversalJournalId ||
            result.journalId,
        },
      );

      if (
        this.options
          .failOnEventPublicationError
      ) {
        throw new ReversalServiceError(
          'Reversal event publication failed.',
          {
            code:
              REVERSAL_ERROR_CODES
                .PERSISTENCE_ERROR,

            statusCode:
              503,

            tenantId:
              request.tenantId,

            originalJournalId:
              result.originalJournalId,

            reversalJournalId:
              result.reversalJournalId ||
              result.journalId,

            retryable:
              true,

            cause:
              error,
          },
        );
      }
    }

    return null;
  }

  async _recordAuditSafe(
    action,
    data,
  ) {
    if (
      !this.auditService
    ) {
      return null;
    }

    const payload = {
      action,

      resourceType:
        'LedgerReversal',

      resourceId:
        data.reversalJournalId ||
        null,

      createdAt:
        isoNow(),

      ...this._sanitizeMetadata(
        data,
      ),
    };

    try {
      if (
        typeof this.auditService
          .record ===
        'function'
      ) {
        return await this.auditService.record(
          payload,
        );
      }

      if (
        typeof this.auditService
          .create ===
        'function'
      ) {
        return await this.auditService.create(
          payload,
        );
      }
    } catch (error) {
      this._logError(
        'Reversal audit persistence failed.',
        error,
        {
          action,

          tenantId:
            data.tenantId ||
            null,

          originalJournalId:
            data.originalJournalId ||
            null,

          reversalJournalId:
            data.reversalJournalId ||
            null,
        },
      );

      if (
        this.options
          .failOnAuditError
      ) {
        throw error;
      }
    }

    return null;
  }

  /* ==========================================================================
   * Metadata
   * ======================================================================== */

  _sanitizeMetadata(
    metadata,
    depth = 0,
  ) {
    if (
      !metadata ||
      typeof metadata !==
        'object'
    ) {
      return {};
    }

    if (
      depth >
      this.options
        .maxMetadataDepth
    ) {
      return '[MAX_DEPTH]';
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
        'pin',
        'otp',
        'passcode',
        'encryptedSecret',
      ]);

    const sanitize =
      (
        value,
        level,
      ) => {
        if (
          level >
          this.options
            .maxMetadataDepth
        ) {
          return '[MAX_DEPTH]';
        }

        if (
          value === null ||
          value === undefined
        ) {
          return value;
        }

        if (
          typeof value ===
            'string'
        ) {
          return value.length >
            this.options
              .maxMetadataStringLength
            ? `${value.slice(
                0,
                this.options
                  .maxMetadataStringLength,
              )}...`
            : value;
        }

        if (
          typeof value ===
              'number'
          ||
          typeof value ===
              'boolean'
        ) {
          return value;
        }

        if (
          value instanceof Date
        ) {
          return value.toISOString();
        }

        if (
          Buffer.isBuffer(
            value,
          )
        ) {
          return '[BUFFER]';
        }

        if (
          Array.isArray(
            value,
          )
        ) {
          return value
            .slice(
              0,
              this.options
                .maxMetadataKeys,
            )
            .map(
              (
                item,
              ) =>
                sanitize(
                  item,
                  level + 1,
                ),
            );
        }

        if (
          typeof value !==
            'object'
        ) {
          return String(
            value,
          );
        }

        const output = {};

        for (
          const [
            key,
            child,
          ] of Object.entries(
            value,
          ).slice(
            0,
            this.options
              .maxMetadataKeys,
          )
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

          output[key] =
            sanitize(
              child,
              level + 1,
            );
        }

        return output;
      };

    return sanitize(
      metadata,
      depth,
    );
  }

  /* ==========================================================================
   * Diagnostics
   * ======================================================================== */

  getStatuses() {
    return Object.freeze({
      ...REVERSAL_STATUS,
    });
  }

  getReasonCodes() {
    return Object.freeze({
      ...REVERSAL_REASON_CODES,
    });
  }

  getErrorCodes() {
    return Object.freeze({
      ...REVERSAL_ERROR_CODES,
    });
  }

  getEntryTypes() {
    return Object.freeze({
      ...ENTRY_TYPE,
    });
  }

  getConfiguration() {
    return Object.freeze({
      strictMode:
        this.options.strictMode,

      requireTenant:
        this.options.requireTenant,

      requireIdempotency:
        this.options.requireIdempotency,

      requireReasonCode:
        this.options.requireReasonCode,

      allowTransactionLookup:
        this.options
          .allowTransactionLookup,

      onlyPostedJournals:
        this.options
          .onlyPostedJournals,

      prohibitMultipleReversals:
        this.options
          .prohibitMultipleReversals,

      prohibitSelfReversal:
        this.options
          .prohibitSelfReversal,

      immutableHistory:
        this.options
          .immutableHistory,

      requireOriginalEntries:
        this.options
          .requireOriginalEntries,

      requireBalancedOriginal:
        this.options
          .requireBalancedOriginal,

      requireAtomicPosting:
        this.options
          .requireAtomicPosting,

      requirePostingEngine:
        this.options
          .requirePostingEngine,

      validateAccountingPeriod:
        this.options
          .validateAccountingPeriod,

      publishEvents:
        this.options.publishEvents,

      hasPostingEngine:
        Boolean(
          this.postingEngine,
        ),

      hasLedgerEngine:
        Boolean(
          this.ledgerEngine,
        ),

      hasJournalRepository:
        Boolean(
          this.journalRepository,
        ),

      hasJournalEntryRepository:
        Boolean(
          this.journalEntryRepository,
        ),

      hasIdempotencyService:
        Boolean(
          this.idempotencyService,
        ),

      hasPeriodCloseService:
        Boolean(
          this.periodCloseService,
        ),

      hasEventPublisher:
        Boolean(
          this.eventPublisher,
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
      this.options.strictMode
      &&
      this.options
        .requirePostingEngine
      &&
      !this.postingEngine
      &&
      !this.ledgerEngine
    ) {
      errors.push(
        'postingEngine or ledgerEngine is required.',
      );
    }

    if (
      this.options.strictMode
      &&
      !this.journalRepository
    ) {
      errors.push(
        'journalRepository is required.',
      );
    }

    if (
      this.options.strictMode
      &&
      this.options
        .requireOriginalEntries
      &&
      !this.journalEntryRepository
    ) {
      errors.push(
        'journalEntryRepository is required.',
      );
    }

    if (
      this.options.strictMode
      &&
      this.options
        .requireIdempotency
      &&
      !this.idempotencyService
    ) {
      errors.push(
        'idempotencyService is required.',
      );
    }

    return {
      valid:
        errors.length ===
        0,

      errors,
    };
  }

  /* ==========================================================================
   * Logging / Metrics
   * ======================================================================== */

  _logError(
    message,
    error,
    metadata = {},
  ) {
    try {
      if (
        this.logger
        &&
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
      // Never mask accounting errors.
    }
  }

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
        typeof this.metrics
          .increment ===
        'function'
      ) {
        this.metrics.increment(
          name,
          value,
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.inc ===
        'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch (_error) {
      // Metrics are observational only.
    }
  }

  /* ==========================================================================
   * Error Normalization
   * ======================================================================== */

  _normalizeError(
    error,
    request,
  ) {
    if (
      error instanceof
      ReversalServiceError
    ) {
      return error;
    }

    return new ReversalServiceError(
      error?.message ||
        'Ledger reversal failed.',
      {
        code:
          error?.code ||
          REVERSAL_ERROR_CODES
            .PERSISTENCE_ERROR,

        statusCode:
          Number(
            error?.statusCode,
          ) || 503,

        tenantId:
          request.tenantId,

        originalJournalId:
          request.journalId ||
          request.originalJournalId,

        transactionId:
          request.transactionId,

        idempotencyKey:
          request.idempotencyKey,

        retryable:
          error?.retryable ===
            true,

        unknownOutcome:
          error?.unknownOutcome ===
            true,

        reconciliationRequired:
          error
            ?.reconciliationRequired ===
            true,

        details:
          error?.details,

        cause:
          error,
      },
    );
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

ReversalService.STATUS =
  REVERSAL_STATUS;

ReversalService.REASON_CODES =
  REVERSAL_REASON_CODES;

ReversalService.ERROR_CODES =
  REVERSAL_ERROR_CODES;

ReversalService.ENTRY_TYPE =
  ENTRY_TYPE;

ReversalService.JOURNAL_STATUS =
  JOURNAL_STATUS;

ReversalService.ReversalServiceError =
  ReversalServiceError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createReversalService(
  dependencies = {},
) {
  return new ReversalService(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  ReversalService;

module.exports.ReversalService =
  ReversalService;

module.exports.ReversalServiceError =
  ReversalServiceError;

module.exports.createReversalService =
  createReversalService;

module.exports.REVERSAL_STATUS =
  REVERSAL_STATUS;

module.exports.REVERSAL_REASON_CODES =
  REVERSAL_REASON_CODES;

module.exports.REVERSAL_ERROR_CODES =
  REVERSAL_ERROR_CODES;

module.exports.ENTRY_TYPE =
  ENTRY_TYPE;

module.exports.JOURNAL_STATUS =
  JOURNAL_STATUS;

/* ============================================================================
 * End of File
 * ============================================================================
 */