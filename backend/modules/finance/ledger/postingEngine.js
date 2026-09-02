'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Financial Ledger Posting Engine
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/ledger/postingEngine.js
 *
 * Purpose
 * -------
 * Production-grade financial posting orchestration layer sitting immediately
 * above the Ledger Engine / journal persistence boundary.
 *
 * Responsibilities
 * ----------------
 * - validate posting intent
 * - construct deterministic posting commands
 * - enforce tenant isolation
 * - enforce idempotency
 * - normalize debit/credit lines
 * - validate double-entry balance
 * - validate account state
 * - coordinate LedgerEngine.post()
 * - support reversal/adjustment orchestration
 * - prevent direct balance mutation
 * - produce deterministic posting fingerprints
 * - preserve financial immutability
 * - support audit/event/metric integration
 * - provide safe retry semantics
 *
 * Architectural boundary
 * ----------------------
 *
 *   Payment / Loan / Contribution / Settlement
 *                           |
 *                           v
 *                    PostingEngine
 *                           |
 *                           v
 *                     LedgerEngine
 *                           |
 *                  +--------+--------+
 *                  |                 |
 *                  v                 v
 *               Journal         JournalEntry
 *                                    |
 *                                    v
 *                               Accounts
 *
 * IMPORTANT
 * ---------
 * PostingEngine is an orchestration and validation boundary.
 *
 * It MUST NOT:
 *
 *   - update account balances directly
 *   - bypass LedgerEngine
 *   - edit posted journals
 *   - delete journal entries
 *   - create financial truth outside the ledger
 *   - retry an unknown external financial operation
 *   - silently convert a failed posting into a successful posting
 *
 * Financial invariant
 * -------------------
 *
 * Every posting must satisfy:
 *
 *   SUM(DEBITS) === SUM(CREDITS)
 *
 * Every posting must also satisfy:
 *
 *   tenantId != null
 *   currency  != null
 *   entries.length >= 2
 *   debitCount >= 1
 *   creditCount >= 1
 *   every account belongs to tenant
 *   every account permits posting
 *   every amount > 0
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const POSTING_STATUS = Object.freeze({
  RECEIVED:
    'RECEIVED',

  VALIDATING:
    'VALIDATING',

  READY:
    'READY',

  POSTING:
    'POSTING',

  POSTED:
    'POSTED',

  REPLAYED:
    'REPLAYED',

  FAILED:
    'FAILED',

  UNKNOWN:
    'UNKNOWN',

  REQUIRES_RECONCILIATION:
    'REQUIRES_RECONCILIATION',

  REVERSED:
    'REVERSED',
});

const ENTRY_TYPE = Object.freeze({
  DEBIT:
    'DEBIT',

  CREDIT:
    'CREDIT',
});

const POSTING_OPERATION_TYPES = Object.freeze({
  POST:
    'POST',

  CONTRIBUTION:
    'CONTRIBUTION',

  WITHDRAWAL:
    'WITHDRAWAL',

  TRANSFER:
    'TRANSFER',

  LOAN_DISBURSEMENT:
    'LOAN_DISBURSEMENT',

  LOAN_REPAYMENT:
    'LOAN_REPAYMENT',

  SETTLEMENT:
    'SETTLEMENT',

  REFUND:
    'REFUND',

  FEE:
    'FEE',

  INTEREST:
    'INTEREST',

  WRITE_OFF:
    'WRITE_OFF',

  ADJUSTMENT:
    'ADJUSTMENT',

  REVERSAL:
    'REVERSAL',
});

const POSTING_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'POSTING_ENGINE_INVALID_REQUEST',

  TENANT_REQUIRED:
    'POSTING_ENGINE_TENANT_REQUIRED',

  OPERATION_TYPE_REQUIRED:
    'POSTING_ENGINE_OPERATION_TYPE_REQUIRED',

  INVALID_OPERATION_TYPE:
    'POSTING_ENGINE_INVALID_OPERATION_TYPE',

  IDEMPOTENCY_REQUIRED:
    'POSTING_ENGINE_IDEMPOTENCY_REQUIRED',

  IDEMPOTENCY_CONFLICT:
    'POSTING_ENGINE_IDEMPOTENCY_CONFLICT',

  CURRENCY_REQUIRED:
    'POSTING_ENGINE_CURRENCY_REQUIRED',

  INVALID_CURRENCY:
    'POSTING_ENGINE_INVALID_CURRENCY',

  ACCOUNT_REQUIRED:
    'POSTING_ENGINE_ACCOUNT_REQUIRED',

  ACCOUNT_NOT_FOUND:
    'POSTING_ENGINE_ACCOUNT_NOT_FOUND',

  ACCOUNT_TENANT_MISMATCH:
    'POSTING_ENGINE_ACCOUNT_TENANT_MISMATCH',

  ACCOUNT_INACTIVE:
    'POSTING_ENGINE_ACCOUNT_INACTIVE',

  ACCOUNT_CURRENCY_MISMATCH:
    'POSTING_ENGINE_ACCOUNT_CURRENCY_MISMATCH',

  ENTRY_REQUIRED:
    'POSTING_ENGINE_ENTRY_REQUIRED',

  INVALID_ENTRY:
    'POSTING_ENGINE_INVALID_ENTRY',

  INVALID_ENTRY_TYPE:
    'POSTING_ENGINE_INVALID_ENTRY_TYPE',

  INVALID_AMOUNT:
    'POSTING_ENGINE_INVALID_AMOUNT',

  ZERO_AMOUNT:
    'POSTING_ENGINE_ZERO_AMOUNT',

  NEGATIVE_AMOUNT:
    'POSTING_ENGINE_NEGATIVE_AMOUNT',

  TOO_MANY_DECIMALS:
    'POSTING_ENGINE_TOO_MANY_DECIMALS',

  BALANCE_MISMATCH:
    'POSTING_ENGINE_BALANCE_MISMATCH',

  DEBIT_REQUIRED:
    'POSTING_ENGINE_DEBIT_REQUIRED',

  CREDIT_REQUIRED:
    'POSTING_ENGINE_CREDIT_REQUIRED',

  MULTI_CURRENCY_UNSUPPORTED:
    'POSTING_ENGINE_MULTI_CURRENCY_UNSUPPORTED',

  ACCOUNT_DUPLICATE:
    'POSTING_ENGINE_ACCOUNT_DUPLICATE',

  JOURNAL_REQUIRED:
    'POSTING_ENGINE_JOURNAL_REQUIRED',

  JOURNAL_NOT_FOUND:
    'POSTING_ENGINE_JOURNAL_NOT_FOUND',

  ALREADY_POSTED:
    'POSTING_ENGINE_ALREADY_POSTED',

  ALREADY_REVERSED:
    'POSTING_ENGINE_ALREADY_REVERSED',

  IMMUTABLE_HISTORY:
    'POSTING_ENGINE_IMMUTABLE_HISTORY',

  PERIOD_CLOSED:
    'POSTING_ENGINE_PERIOD_CLOSED',

  DATE_REQUIRED:
    'POSTING_ENGINE_DATE_REQUIRED',

  INVALID_DATE:
    'POSTING_ENGINE_INVALID_DATE',

  LEDGER_ENGINE_REQUIRED:
    'POSTING_ENGINE_LEDGER_ENGINE_REQUIRED',

  IDEMPOTENCY_SERVICE_REQUIRED:
    'POSTING_ENGINE_IDEMPOTENCY_SERVICE_REQUIRED',

  ATOMICITY_REQUIRED:
    'POSTING_ENGINE_ATOMICITY_REQUIRED',

  PERSISTENCE_ERROR:
    'POSTING_ENGINE_PERSISTENCE_ERROR',

  CONCURRENCY_CONFLICT:
    'POSTING_ENGINE_CONCURRENCY_CONFLICT',

  UNKNOWN_OUTCOME:
    'POSTING_ENGINE_UNKNOWN_OUTCOME',

  RECONCILIATION_REQUIRED:
    'POSTING_ENGINE_RECONCILIATION_REQUIRED',

  CONFIGURATION_ERROR:
    'POSTING_ENGINE_CONFIGURATION_ERROR',
});

const ACCOUNT_STATUS = Object.freeze({
  ACTIVE:
    'ACTIVE',

  FROZEN:
    'FROZEN',

  BLOCKED:
    'BLOCKED',

  CLOSED:
    'CLOSED',

  SUSPENDED:
    'SUSPENDED',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode:
    true,

  requireTenant:
    true,

  requireIdempotency:
    true,

  requireOperationType:
    true,

  requireCurrency:
    true,

  requireAccountingDate:
    true,

  requireDoubleEntry:
    true,

  maxEntries:
    100,

  maxDecimalPlaces:
    2,

  maxDescriptionLength:
    1000,

  maxReferenceLength:
    255,

  rejectMixedCurrencies:
    true,

  rejectZeroNetPostings:
    true,

  rejectInactiveAccounts:
    true,

  immutableHistory:
    true,

  allowMultipleLinesPerAccount:
    true,

  aggregateDuplicateAccounts:
    false,

  validateBeforeLedger:
    true,

  publishEvents:
    true,

  failOnEventPublicationError:
    false,

  failOnAuditError:
    false,

  retainMetadata:
    true,

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

class PostingEngineError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'PostingEngineError';

    this.code =
      options.code ||
      POSTING_ERROR_CODES
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

    this.operationType =
      options.operationType ||
      null;

    this.idempotencyKey =
      options.idempotencyKey ||
      null;

    this.transactionId =
      options.transactionId ||
      null;

    this.journalId =
      options.journalId ||
      null;

    this.postingReference =
      options.postingReference ||
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
      PostingEngineError,
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

function createPostingReference(
  prefix = 'GL',
) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(4)
    .toString('hex')
    .toUpperCase()}`;
}

function createPostingOperationId() {
  return `posting_op_${crypto.randomUUID()}`;
}

/* ============================================================================
 * Decimal Arithmetic
 * ========================================================================== */

function decimalToScaledInteger(
  value,
  scale,
) {
  const raw =
    normalizeString(
      String(
        value,
      ),
    );

  if (
    !raw
  ) {
    return null;
  }

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

  const padded =
    fractionPart.padEnd(
      scale,
      '0',
    );

  return (
    BigInt(
      integerPart,
    ) *
      10n ** BigInt(scale) +
    BigInt(
      padded || '0',
    )
  );
}

function scaledIntegerToDecimal(
  value,
  scale,
) {
  const amount =
    BigInt(
      value,
    );

  const divisor =
    10n ** BigInt(scale);

  const whole =
    amount / divisor;

  if (
    scale === 0
  ) {
    return whole.toString();
  }

  const remainder =
    amount %
    divisor;

  const fraction =
    remainder
      .toString()
      .padStart(
        scale,
        '0',
      )
      .replace(
        /0+$/,
        '',
      );

  return fraction
    ? `${whole}.${fraction}`
    : whole.toString();
}

function canonicalAmount(
  value,
  scale,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const raw =
    String(
      value,
    ).trim();

  if (
    !/^\d+(\.\d+)?$/.test(
      raw,
    )
  ) {
    return null;
  }

  const scaled =
    decimalToScaledInteger(
      raw,
      scale,
    );

  if (
    scaled === null
  ) {
    return null;
  }

  return scaledIntegerToDecimal(
    scaled,
    scale,
  );
}

function sumAmounts(
  amounts,
  scale,
) {
  let total =
    0n;

  for (
    const amount of
      amounts
  ) {
    const scaled =
      decimalToScaledInteger(
        amount,
        scale,
      );

    if (
      scaled === null
    ) {
      return null;
    }

    total +=
      scaled;
  }

  return scaledIntegerToDecimal(
    total,
    scale,
  );
}

/* ============================================================================
 * Posting Engine
 * ========================================================================== */

class PostingEngine {
  /**
   * Dependencies:
   *
   *   ledgerEngine               required
   *   accountRepository          recommended
   *   accountService             recommended
   *   idempotencyService         required in production
   *   periodCloseService         recommended
   *   eventPublisher             recommended
   *   auditService               recommended
   *   metrics                    optional
   *   logger                     optional
   */
  constructor(
    dependencies = {},
  ) {
    this.ledgerEngine =
      dependencies.ledgerEngine ||
      null;

    this.accountRepository =
      dependencies.accountRepository ||
      null;

    this.accountService =
      dependencies.accountService ||
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
   * Main API
   * ======================================================================== */

  /**
   * Validate and post a financial journal through LedgerEngine.
   *
   * The PostingEngine owns pre-posting validation and command normalization.
   * LedgerEngine remains the authoritative financial persistence boundary.
   */
  async post(
    input = {},
  ) {
    const request =
      this._normalizeRequest(
        input,
      );

    request.operationId =
      request.operationId ||
      createPostingOperationId();

    this._validateRequest(
      request,
    );

    this._metric(
      'ledger_posting_engine_received_total',
      1,
      {
        operationType:
          request.operationType,
      },
    );

    const fingerprint =
      this._buildPostingFingerprint(
        request,
      );

    const existing =
      await this._findExistingPosting(
        request,
        fingerprint,
      );

    if (
      existing
    ) {
      this._metric(
        'ledger_posting_engine_replayed_total',
        1,
        {
          operationType:
            request.operationType,
        },
      );

      return this._buildReplayResult(
        existing,
      );
    }

    await this._validateAccounts(
      request,
    );

    await this._validateAccountingPeriod(
      request,
    );

    const normalizedEntries =
      this._normalizeEntries(
        request.entries,
        request.currency,
      );

    this._validateDoubleEntry(
      normalizedEntries,
      request.currency,
    );

    const postingCommand =
      this._buildPostingCommand(
        request,
        normalizedEntries,
        fingerprint,
      );

    const idempotency =
      await this._reserveIdempotency(
        request,
        postingCommand,
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
        await this._executeLedgerPost(
          postingCommand,
        );
    } catch (error) {
      await this._handlePostingFailure(
        request,
        idempotency,
        error,
      );

      throw this._normalizePostingError(
        error,
        request,
      );
    }

    /**
     * Ledger persistence is authoritative. Idempotency is finalized after the
     * ledger result exists.
     */
    try {
      await this._completeIdempotency(
        idempotency,
        result,
        request,
      );
    } catch (error) {
      /**
       * Do not reverse a successfully committed financial posting merely
       * because idempotency finalization failed. The repository uniqueness
       * boundary and subsequent replay lookup remain authoritative.
       */
      this._logError(
        'Ledger posting succeeded but idempotency finalization failed.',
        error,
        {
          tenantId:
            request.tenantId,

          journalId:
            result.journalId,

          operationId:
            request.operationId,
        },
      );

      this._metric(
        'ledger_posting_engine_idempotency_finalization_failure_total',
        1,
      );
    }

    await this._publishEventSafe(
      this._eventTypeForResult(
        result,
        request,
      ),
      result,
      request,
    );

    await this._recordAuditSafe(
      'LEDGER_POSTING_ENGINE_POSTED',
      {
        tenantId:
          request.tenantId,

        operationType:
          request.operationType,

        journalId:
          result.journalId,

        postingReference:
          result.postingReference,

        transactionId:
          request.transactionId,
      },
    );

    this._metric(
      'ledger_posting_engine_posted_total',
      1,
      {
        operationType:
          request.operationType,
        currency:
          request.currency,
      },
    );

    return {
      ...result,

      operationId:
        request.operationId,

      postingFingerprint:
        fingerprint,

      postingEngineStatus:
        POSTING_STATUS.POSTED,
    };
  }

  /**
   * Explicit alias for systems that use "postJournal".
   */
  async postJournal(
    input = {},
  ) {
    return this.post(
      input,
    );
  }

  /**
   * Prepare a posting without committing it.
   *
   * This is useful for approval/preview workflows. It does not create
   * financial state.
   */
  async validate(
    input = {},
  ) {
    const request =
      this._normalizeRequest(
        input,
      );

    request.operationId =
      request.operationId ||
      createPostingOperationId();

    this._validateRequest(
      request,
    );

    const fingerprint =
      this._buildPostingFingerprint(
        request,
      );

    await this._validateAccounts(
      request,
    );

    await this._validateAccountingPeriod(
      request,
    );

    const entries =
      this._normalizeEntries(
        request.entries,
        request.currency,
      );

    const totals =
      this._validateDoubleEntry(
        entries,
        request.currency,
      );

    const command =
      this._buildPostingCommand(
        request,
        entries,
        fingerprint,
      );

    return {
      valid:
        true,

      status:
        POSTING_STATUS.READY,

      operationId:
        request.operationId,

      postingFingerprint:
        fingerprint,

      tenantId:
        request.tenantId,

      operationType:
        request.operationType,

      currency:
        request.currency,

      accountingDate:
        request.accountingDate,

      transactionId:
        request.transactionId,

      totals,

      entryCount:
        entries.length,

      command:
        this._sanitizeCommand(
          command,
        ),
    };
  }

  /* ==========================================================================
   * Reversal
   * ======================================================================== */

  /**
   * Create a compensating reversal through LedgerEngine.
   *
   * Original journal/entries are never edited.
   */
  async reverse(
    input = {},
  ) {
    const request =
      this._normalizeReversalRequest(
        input,
      );

    this._validateReversalRequest(
      request,
    );

    if (
      !this.ledgerEngine
    ) {
      throw new PostingEngineError(
        'LedgerEngine is required for reversal.',
        {
          code:
            POSTING_ERROR_CODES
              .LEDGER_ENGINE_REQUIRED,

          statusCode:
            500,
        },
      );
    }

    let result;

    if (
      typeof this.ledgerEngine
        .reverseJournal ===
      'function'
    ) {
      result =
        await this.ledgerEngine
          .reverseJournal(
            request,
          );
    } else if (
      typeof this.ledgerEngine
        .reverseTransaction ===
      'function'
    ) {
      result =
        await this.ledgerEngine
          .reverseTransaction(
            request,
          );
    } else {
      throw new PostingEngineError(
        'Configured LedgerEngine does not support reversal.',
        {
          code:
            POSTING_ERROR_CODES
              .LEDGER_ENGINE_REQUIRED,

          statusCode:
            500,
        },
      );
    }

    await this._publishEventSafe(
      'LedgerPostingReversed',
      result,
      request,
    );

    await this._recordAuditSafe(
      'LEDGER_POSTING_ENGINE_REVERSED',
      {
        tenantId:
          request.tenantId,

        originalJournalId:
          request.journalId ||
          request.originalJournalId,

        reversalJournalId:
          result?.journalId ||
          null,

        reasonCode:
          request.reasonCode,
      },
    );

    this._metric(
      'ledger_posting_engine_reversals_total',
      1,
    );

    return {
      ...result,

      postingEngineStatus:
        POSTING_STATUS.REVERSED,
    };
  }

  async reverseJournal(
    input = {},
  ) {
    return this.reverse(
      input,
    );
  }

  /**
   * Create an accounting adjustment.
   *
   * Adjustments are still double-entry postings and are therefore routed
   * through LedgerEngine.
   */
  async createAdjustment(
    input = {},
  ) {
    return this.post({
      ...input,

      operationType:
        POSTING_OPERATION_TYPES
          .ADJUSTMENT,

      source:
        input.source ||
        'ADJUSTMENT',
    });
  }

  async createAdjustmentEntry(
    input = {},
  ) {
    return this.createAdjustment(
      input,
    );
  }

  /* ==========================================================================
   * Account Validation
   * ======================================================================== */

  async _validateAccounts(
    request,
  ) {
    if (
      !this.options
        .validateBeforeLedger
    ) {
      return [];
    }

    const accountIds =
      [
        ...new Set(
          request.entries
            .map(
              (
                entry,
              ) =>
                normalizeAccountId(
                  entry.accountId ||
                    entry.account,
                ),
            )
            .filter(Boolean),
        ),
      ];

    if (
      !accountIds.length
    ) {
      throw new PostingEngineError(
        'At least one ledger account is required.',
        {
          code:
            POSTING_ERROR_CODES
              .ACCOUNT_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      !this.accountRepository
      && !this.accountService
    ) {
      if (
        this.options.strictMode
      ) {
        throw new PostingEngineError(
          'Account repository/service is required in strict mode.',
          {
            code:
              POSTING_ERROR_CODES
                .CONFIGURATION_ERROR,

            statusCode:
              500,

            tenantId:
              request.tenantId,
          },
        );
      }

      return [];
    }

    const accounts =
      await this._loadAccounts(
        accountIds,
        request.tenantId,
      );

    const foundIds =
      new Set(
        accounts.map(
          (
            account,
          ) =>
            safeId(
              account._id ||
                account.id,
            ),
        ),
      );

    const missing =
      accountIds.filter(
        (
          id,
        ) =>
          !foundIds.has(
            id,
          ),
      );

    if (
      missing.length
    ) {
      throw new PostingEngineError(
        'One or more ledger accounts were not found.',
        {
          code:
            POSTING_ERROR_CODES
              .ACCOUNT_NOT_FOUND,

          statusCode:
            404,

          tenantId:
            request.tenantId,

          details: {
            missingAccountIds:
              missing,
          },
        },
      );
    }

    for (
      const account of
        accounts
    ) {
      const accountId =
        safeId(
          account._id ||
            account.id,
        );

      if (
        account.tenantId
        &&
        account.tenantId !==
          request.tenantId
      ) {
        throw new PostingEngineError(
          'Ledger account belongs to another tenant.',
          {
            code:
              POSTING_ERROR_CODES
                .ACCOUNT_TENANT_MISMATCH,

            statusCode:
              403,

            tenantId:
              request.tenantId,

            details: {
              accountId,
            },
          },
        );
      }

      const status =
        normalizeStatus(
          account.status ||
            (
              account.isActive ===
              false
                ? ACCOUNT_STATUS.CLOSED
                : ACCOUNT_STATUS.ACTIVE
            ),
        );

      if (
        this.options
          .rejectInactiveAccounts
        &&
        [
          ACCOUNT_STATUS.FROZEN,
          ACCOUNT_STATUS.BLOCKED,
          ACCOUNT_STATUS.CLOSED,
          ACCOUNT_STATUS.SUSPENDED,
        ].includes(
          status,
        )
      ) {
        throw new PostingEngineError(
          'Ledger account does not allow posting.',
          {
            code:
              POSTING_ERROR_CODES
                .ACCOUNT_INACTIVE,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            details: {
              accountId,
              status,
            },
          },
        );
      }

      const currency =
        normalizeCurrency(
          account.currency,
        );

      if (
        currency
        &&
        currency !==
          request.currency
      ) {
        throw new PostingEngineError(
          'Account currency does not match posting currency.',
          {
            code:
              POSTING_ERROR_CODES
                .ACCOUNT_CURRENCY_MISMATCH,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            details: {
              accountId,
              accountCurrency:
                currency,
              postingCurrency:
                request.currency,
            },
          },
        );
      }
    }

    return accounts;
  }

  async _loadAccounts(
    accountIds,
    tenantId,
  ) {
    if (
      this.accountService
      &&
      typeof this.accountService
        .getAccountsByIds ===
      'function'
    ) {
      const accounts =
        await this.accountService
          .getAccountsByIds(
            accountIds,
            {
              tenantId,
            },
          );

      return Array.isArray(
        accounts,
      )
        ? accounts
        : [];
    }

    if (
      this.accountRepository
      &&
      typeof this.accountRepository
        .findByIds ===
      'function'
    ) {
      const accounts =
        await this.accountRepository
          .findByIds(
            accountIds,
            {
              tenantId,
            },
          );

      return Array.isArray(
        accounts,
      )
        ? accounts
        : [];
    }

    if (
      this.accountRepository
      &&
      typeof this.accountRepository
        .findById ===
      'function'
    ) {
      const accounts =
        [];

      for (
        const id of
          accountIds
      ) {
        const account =
          await this.accountRepository
            .findById(
              id,
              {
                tenantId,
              },
            );

        if (
          account
        ) {
          accounts.push(
            account,
          );
        }
      }

      return accounts;
    }

    if (
      this.accountRepository
      &&
      typeof this.accountRepository
        .find ===
      'function'
    ) {
      const accounts =
        await this.accountRepository
          .find(
            {
              tenantId,
              _id: {
                $in:
                  accountIds,
              },
            },
          );

      return Array.isArray(
        accounts,
      )
        ? accounts
        : [];
    }

    throw new PostingEngineError(
      'Account repository/service does not implement a supported lookup method.',
      {
        code:
          POSTING_ERROR_CODES
            .PERSISTENCE_ERROR,

        statusCode:
          500,

        tenantId,
      },
    );
  }

  /* ==========================================================================
   * Accounting Period
   * ======================================================================== */

  async _validateAccountingPeriod(
    request,
  ) {
    if (
      !this.periodCloseService
    ) {
      return true;
    }

    const date =
      parseDate(
        request.accountingDate,
      );

    if (
      !date
    ) {
      throw new PostingEngineError(
        'Valid accounting date is required.',
        {
          code:
            POSTING_ERROR_CODES
              .INVALID_DATE,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      typeof this.periodCloseService
        .assertOpen ===
      'function'
    ) {
      const open =
        await this.periodCloseService
          .assertOpen(
            {
              tenantId:
                request.tenantId,

              accountingDate:
                date,
            },
          );

      if (
        open === false
      ) {
        throw new PostingEngineError(
          'Accounting period is closed.',
          {
            code:
              POSTING_ERROR_CODES
                .PERIOD_CLOSED,

            statusCode:
              409,

            tenantId:
              request.tenantId,
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
        throw new PostingEngineError(
          'Accounting period is closed.',
          {
            code:
              POSTING_ERROR_CODES
                .PERIOD_CLOSED,

            statusCode:
              409,

            tenantId:
              request.tenantId,
          },
        );
      }
    }

    return true;
  }

  /* ==========================================================================
   * Entry Normalization / Validation
   * ======================================================================== */

  _normalizeEntries(
    entries,
    currency,
  ) {
    if (
      !Array.isArray(
        entries,
      ) ||
      !entries.length
    ) {
      throw new PostingEngineError(
        'Journal entries are required.',
        {
          code:
            POSTING_ERROR_CODES
              .ENTRY_REQUIRED,
        },
      );
    }

    if (
      entries.length >
      this.options.maxEntries
    ) {
      throw new PostingEngineError(
        `A posting may contain at most ${this.options.maxEntries} entries.`,
        {
          code:
            POSTING_ERROR_CODES
              .INVALID_ENTRY,

          statusCode:
            400,
        },
      );
    }

    const normalized =
      entries.map(
        (
          entry,
          index,
        ) => {
          if (
            !entry
            ||
            typeof entry !==
              'object'
          ) {
            throw new PostingEngineError(
              `Posting entry ${index + 1} is invalid.`,
              {
                code:
                  POSTING_ERROR_CODES
                    .INVALID_ENTRY,

                details: {
                  index,
                },
              },
            );
          }

          const accountId =
            normalizeAccountId(
              entry.accountId ||
                entry.account ||
                entry.accountIdRef,
            );

          if (
            !accountId
          ) {
            throw new PostingEngineError(
              `Posting entry ${index + 1} has no account.`,
              {
                code:
                  POSTING_ERROR_CODES
                    .ACCOUNT_REQUIRED,

                details: {
                  index,
                },
              },
            );
          }

          const entryType =
            normalizeStatus(
              entry.entryType ||
                entry.type,
            );

          if (
            ![
              ENTRY_TYPE.DEBIT,
              ENTRY_TYPE.CREDIT,
            ].includes(
              entryType,
            )
          ) {
            throw new PostingEngineError(
              `Posting entry ${index + 1} has an invalid entry type.`,
              {
                code:
                  POSTING_ERROR_CODES
                    .INVALID_ENTRY_TYPE,

                details: {
                  index,
                  entryType,
                },
              },
            );
          }

          const amount =
            canonicalAmount(
              entry.amount,
              this.options
                .maxDecimalPlaces,
            );

          if (
            !amount
          ) {
            throw new PostingEngineError(
              `Posting entry ${index + 1} has an invalid amount.`,
              {
                code:
                  POSTING_ERROR_CODES
                    .INVALID_AMOUNT,

                details: {
                  index,
                  accountId,
                },
              },
            );
          }

          const scaled =
            decimalToScaledInteger(
              amount,
              this.options
                .maxDecimalPlaces,
            );

          if (
            scaled ===
              null
            ||
            scaled <= 0n
          ) {
            throw new PostingEngineError(
              `Posting entry ${index + 1} amount must be greater than zero.`,
              {
                code:
                  POSTING_ERROR_CODES
                    .ZERO_AMOUNT,

                details: {
                  index,
                  accountId,
                },
              },
            );
          }

          const entryCurrency =
            normalizeCurrency(
              entry.currency ||
                currency,
            );

          if (
            this.options
              .rejectMixedCurrencies
            &&
            entryCurrency !==
              currency
          ) {
            throw new PostingEngineError(
              'Mixed currencies are not permitted within a single posting.',
              {
                code:
                  POSTING_ERROR_CODES
                    .MULTI_CURRENCY_UNSUPPORTED,

                statusCode:
                  400,

                details: {
                  accountId,
                  entryCurrency,
                  postingCurrency:
                    currency,
                },
              },
            );
          }

          return {
            id:
              safeId(
                entry.id ||
                  entry._id,
              ) ||
              null,

            accountId,

            entryType,

            type:
              entryType,

            amount,

            currency:
              entryCurrency,

            description:
              normalizeString(
                entry.description,
              ),

            reference:
              normalizeString(
                entry.reference,
              ),

            sequence:
              Number.isInteger(
                entry.sequence,
              )
                ? entry.sequence
                : index + 1,

            metadata:
              this._sanitizeMetadata(
                entry.metadata,
              ),
          };
        },
      );

    if (
      this.options.aggregateDuplicateAccounts
    ) {
      return this._aggregateEntries(
        normalized,
      );
    }

    return normalized;
  }

  _aggregateEntries(
    entries,
  ) {
    const aggregate =
      new Map();

    for (
      const entry of
        entries
    ) {
      const key =
        [
          entry.accountId,
          entry.entryType,
          entry.currency,
        ].join(':');

      if (
        !aggregate.has(
          key,
        )
      ) {
        aggregate.set(
          key,
          {
            ...entry,
          },
        );

        continue;
      }

      const current =
        aggregate.get(
          key,
        );

      current.amount =
        sumAmounts(
          [
            current.amount,
            entry.amount,
          ],
          this.options
            .maxDecimalPlaces,
        );
    }

    return [
      ...aggregate.values(),
    ].map(
      (
        entry,
        index,
      ) => ({
        ...entry,
        sequence:
          index + 1,
      }),
    );
  }

  _validateDoubleEntry(
    entries,
    currency,
  ) {
    if (
      !this.options
        .requireDoubleEntry
    ) {
      return {
        debitTotal:
          null,

        creditTotal:
          null,
      };
    }

    let debitTotal =
      0n;

    let creditTotal =
      0n;

    let debitCount =
      0;

    let creditCount =
      0;

    for (
      const entry of
        entries
    ) {
      const amount =
        decimalToScaledInteger(
          entry.amount,
          this.options
            .maxDecimalPlaces,
        );

      if (
        amount ===
        null
      ) {
        throw new PostingEngineError(
          'Posting contains an invalid amount.',
          {
            code:
              POSTING_ERROR_CODES
                .INVALID_AMOUNT,
          },
        );
      }

      if (
        entry.entryType ===
        ENTRY_TYPE.DEBIT
      ) {
        debitCount +=
          1;

        debitTotal +=
          amount;
      } else if (
        entry.entryType ===
        ENTRY_TYPE.CREDIT
      ) {
        creditCount +=
          1;

        creditTotal +=
          amount;
      }
    }

    if (
      debitCount ===
      0
    ) {
      throw new PostingEngineError(
        'Posting must contain at least one debit.',
        {
          code:
            POSTING_ERROR_CODES
              .DEBIT_REQUIRED,
        },
      );
    }

    if (
      creditCount ===
      0
    ) {
      throw new PostingEngineError(
        'Posting must contain at least one credit.',
        {
          code:
            POSTING_ERROR_CODES
              .CREDIT_REQUIRED,
        },
      );
    }

    if (
      this.options
        .rejectZeroNetPostings
      &&
      debitTotal ===
        0n
      &&
      creditTotal ===
        0n
    ) {
      throw new PostingEngineError(
        'Zero-value postings are not permitted.',
        {
          code:
            POSTING_ERROR_CODES
              .ZERO_AMOUNT,
        },
      );
    }

    if (
      debitTotal !==
      creditTotal
    ) {
      throw new PostingEngineError(
        'Debits and credits must balance exactly.',
        {
          code:
            POSTING_ERROR_CODES
              .BALANCE_MISMATCH,

          details: {
            currency,

            debitTotal:
              scaledIntegerToDecimal(
                debitTotal,
                this.options
                  .maxDecimalPlaces,
              ),

            creditTotal:
              scaledIntegerToDecimal(
                creditTotal,
                this.options
                  .maxDecimalPlaces,
              ),
          },
        },
      );
    }

    return {
      debitTotal:
        scaledIntegerToDecimal(
          debitTotal,
          this.options
            .maxDecimalPlaces,
        ),

      creditTotal:
        scaledIntegerToDecimal(
          creditTotal,
          this.options
            .maxDecimalPlaces,
        ),

      debitCount,

      creditCount,
    };
  }

  /* ==========================================================================
   * Request Validation
   * ======================================================================== */

  _validateRequest(
    request,
  ) {
    if (
      this.options.requireTenant
      && !request.tenantId
    ) {
      throw new PostingEngineError(
        'Tenant ID is required.',
        {
          code:
            POSTING_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,
        },
      );
    }

    if (
      this.options
        .requireOperationType
      && !request.operationType
    ) {
      throw new PostingEngineError(
        'Operation type is required.',
        {
          code:
            POSTING_ERROR_CODES
              .OPERATION_TYPE_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.operationType
      &&
      !/^[A-Z][A-Z0-9_]{1,99}$/.test(
        request.operationType,
      )
    ) {
      throw new PostingEngineError(
        'Invalid operation type.',
        {
          code:
            POSTING_ERROR_CODES
              .INVALID_OPERATION_TYPE,

          statusCode:
            400,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,
        },
      );
    }

    if (
      this.options.requireIdempotency
      && !request.idempotencyKey
    ) {
      throw new PostingEngineError(
        'Idempotency key is required for financial posting.',
        {
          code:
            POSTING_ERROR_CODES
              .IDEMPOTENCY_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      this.options.requireCurrency
      && !request.currency
    ) {
      throw new PostingEngineError(
        'Posting currency is required.',
        {
          code:
            POSTING_ERROR_CODES
              .CURRENCY_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.currency
      &&
      !/^[A-Z]{3}$/.test(
        request.currency,
      )
    ) {
      throw new PostingEngineError(
        'Posting currency must be a three-letter code.',
        {
          code:
            POSTING_ERROR_CODES
              .INVALID_CURRENCY,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      this.options
        .requireAccountingDate
      &&
      !request.accountingDate
    ) {
      throw new PostingEngineError(
        'Accounting date is required.',
        {
          code:
            POSTING_ERROR_CODES
              .DATE_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
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
      throw new PostingEngineError(
        'Accounting date is invalid.',
        {
          code:
            POSTING_ERROR_CODES
              .INVALID_DATE,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      !Array.isArray(
        request.entries,
      )
      ||
      request.entries.length <
        2
    ) {
      throw new PostingEngineError(
        'A double-entry posting requires at least two entries.',
        {
          code:
            POSTING_ERROR_CODES
              .ENTRY_REQUIRED,

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
      throw new PostingEngineError(
        'Posting description is too long.',
        {
          code:
            POSTING_ERROR_CODES
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
      throw new PostingEngineError(
        'Posting reference is too long.',
        {
          code:
            POSTING_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }
  }

  _validateReversalRequest(
    request,
  ) {
    if (
      this.options.requireTenant
      && !request.tenantId
    ) {
      throw new PostingEngineError(
        'Tenant ID is required for reversal.',
        {
          code:
            POSTING_ERROR_CODES
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
      throw new PostingEngineError(
        'Journal ID or transaction ID is required for reversal.',
        {
          code:
            POSTING_ERROR_CODES
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
      && !request.idempotencyKey
    ) {
      throw new PostingEngineError(
        'Reversal idempotency key is required.',
        {
          code:
            POSTING_ERROR_CODES
              .IDEMPOTENCY_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      !request.reasonCode
    ) {
      throw new PostingEngineError(
        'Reversal reason code is required.',
        {
          code:
            POSTING_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }
  }

  /* ==========================================================================
   * Posting Command
   * ======================================================================== */

  _buildPostingCommand(
    request,
    entries,
    fingerprint,
  ) {
    const totals =
      this._calculateTotals(
        entries,
      );

    return {
      operationId:
        request.operationId,

      tenantId:
        request.tenantId,

      operationType:
        request.operationType,

      idempotencyKey:
        request.idempotencyKey,

      transactionId:
        request.transactionId,

      journalId:
        request.journalId,

      postingReference:
        request.reference ||
        createPostingReference(),

      externalReference:
        request.externalReference,

      currency:
        request.currency,

      accountingDate:
        request.accountingDate,

      effectiveAt:
        request.effectiveAt ||
        request.accountingDate,

      description:
        request.description,

      source:
        request.source ||
        request.operationType,

      sourceId:
        request.sourceId ||
        request.transactionId ||
        null,

      reversalOfJournalId:
        request.reversalOfJournalId ||
        null,

      reasonCode:
        request.reasonCode ||
        null,

      entries,

      totals,

      postingFingerprint:
        fingerprint,

      metadata:
        this.options.retainMetadata
          ? this._sanitizeMetadata(
              request.metadata,
            )
          : {},

      createdAt:
        isoNow(),
    };
  }

  _calculateTotals(
    entries,
  ) {
    const debitAmounts =
      entries
        .filter(
          (
            entry,
          ) =>
            entry.entryType ===
            ENTRY_TYPE.DEBIT,
        )
        .map(
          (
            entry,
          ) =>
            entry.amount,
        );

    const creditAmounts =
      entries
        .filter(
          (
            entry,
          ) =>
            entry.entryType ===
            ENTRY_TYPE.CREDIT,
        )
        .map(
          (
            entry,
          ) =>
            entry.amount,
        );

    return {
      debitTotal:
        sumAmounts(
          debitAmounts,
          this.options
            .maxDecimalPlaces,
        ),

      creditTotal:
        sumAmounts(
          creditAmounts,
          this.options
            .maxDecimalPlaces,
        ),

      debitCount:
        debitAmounts.length,

      creditCount:
        creditAmounts.length,
    };
  }

  _sanitizeCommand(
    command,
  ) {
    return {
      operationId:
        command.operationId,

      tenantId:
        command.tenantId,

      operationType:
        command.operationType,

      transactionId:
        command.transactionId,

      postingReference:
        command.postingReference,

      externalReference:
        command.externalReference,

      currency:
        command.currency,

      accountingDate:
        command.accountingDate,

      effectiveAt:
        command.effectiveAt,

      description:
        command.description,

      source:
        command.source,

      sourceId:
        command.sourceId,

      reversalOfJournalId:
        command.reversalOfJournalId,

      reasonCode:
        command.reasonCode,

      totals:
        command.totals,

      entryCount:
        command.entries?.length ||
        0,

      entries:
        command.entries?.map(
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

            sequence:
              entry.sequence,
          }),
        ),
    };
  }

  /* ==========================================================================
   * Fingerprint / Idempotency
   * ======================================================================== */

  _buildPostingFingerprint(
    request,
  ) {
    return sha256({
      tenantId:
        request.tenantId,

      operationType:
        request.operationType,

      transactionId:
        request.transactionId,

      currency:
        request.currency,

      accountingDate:
        request.accountingDate,

      effectiveAt:
        request.effectiveAt,

      source:
        request.source,

      sourceId:
        request.sourceId,

      reversalOfJournalId:
        request.reversalOfJournalId,

      entries:
        request.entries
          .map(
            (
              entry,
            ) => ({
              accountId:
                normalizeAccountId(
                  entry.accountId ||
                    entry.account,
                ),

              entryType:
                normalizeStatus(
                  entry.entryType ||
                    entry.type,
                ),

              amount:
                canonicalAmount(
                  entry.amount,
                  this.options
                    .maxDecimalPlaces,
                ),

              currency:
                normalizeCurrency(
                  entry.currency ||
                    request.currency,
                ),
            }),
          )
          .sort(
            (
              a,
              b,
            ) => {
              const left =
                `${a.accountId}:${a.entryType}`;

              const right =
                `${b.accountId}:${b.entryType}`;

              return left.localeCompare(
                right,
              );
            },
          ),
    });
  }

  async _findExistingPosting(
    request,
    fingerprint,
  ) {
    if (
      !this.idempotencyService
    ) {
      return this._findExistingInLedger(
        request,
        fingerprint,
      );
    }

    if (
      typeof this.idempotencyService
        .getExisting ===
      'function'
    ) {
      const existing =
        await this.idempotencyService
          .getExisting(
            {
              tenantId:
                request.tenantId,

              operationType:
                request.operationType,

              key:
                request.idempotencyKey,
            },
          );

      if (
        existing
      ) {
        return this._validateExistingIdempotencyResult(
          existing,
          request,
          fingerprint,
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
              {
                tenantId:
                  request.tenantId,

                operationType:
                  request.operationType,

                key:
                  request.idempotencyKey,
              },
            );

        if (
          existing
        ) {
          return this._validateExistingIdempotencyResult(
            existing,
            request,
            fingerprint,
          );
        }
      } catch (error) {
        if (
          error?.code !==
          'TRANSACTION_IDEMPOTENCY_NOT_FOUND'
        ) {
          throw error;
        }
      }
    }

    return this._findExistingInLedger(
      request,
      fingerprint,
    );
  }

  _validateExistingIdempotencyResult(
    existing,
    request,
    fingerprint,
  ) {
    const existingFingerprint =
      existing.requestFingerprint ||
      existing.result?.postingFingerprint ||
      existing.result?.requestFingerprint;

    if (
      existingFingerprint
      &&
      existingFingerprint !==
        fingerprint
    ) {
      throw new PostingEngineError(
        'Idempotency key was reused with a different posting payload.',
        {
          code:
            POSTING_ERROR_CODES
              .IDEMPOTENCY_CONFLICT,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,

          idempotencyKey:
            request.idempotencyKey,

          journalId:
            existing.result?.journalId ||
            existing.journalId ||
            null,
        },
      );
    }

    if (
      existing.completed
      && existing.result
    ) {
      return {
        replay:
          true,

        completed:
          true,

        result:
          existing.result,
      };
    }

    if (
      existing.status ===
        'UNKNOWN'
      ||
      existing.unknown ===
        true
    ) {
      throw new PostingEngineError(
        'Posting operation has an unknown outcome and requires reconciliation.',
        {
          code:
            POSTING_ERROR_CODES
              .UNKNOWN_OUTCOME,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,

          idempotencyKey:
            request.idempotencyKey,

          retryable:
            false,

          unknownOutcome:
            true,

          reconciliationRequired:
            true,
        },
      );
    }

    if (
      existing.inProgress
    ) {
      throw new PostingEngineError(
        'Posting operation is already being processed.',
        {
          code:
            POSTING_ERROR_CODES
              .CONCURRENCY_CONFLICT,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,

          idempotencyKey:
            request.idempotencyKey,
        },
      );
    }

    return null;
  }

  async _findExistingInLedger(
    request,
    fingerprint,
  ) {
    if (
      !this.ledgerEngine
    ) {
      return null;
    }

    if (
      typeof this.ledgerEngine
        .getJournalByIdempotencyKey !==
      'function'
    ) {
      return null;
    }

    try {
      const existing =
        await this.ledgerEngine
          .getJournalByIdempotencyKey(
            {
              tenantId:
                request.tenantId,

              operationType:
                request.operationType,

              idempotencyKey:
                request.idempotencyKey,
            },
          );

      if (
        !existing
      ) {
        return null;
      }

      const normalizedFingerprint =
        existing.journal
          ?.payloadFingerprint ||
        existing.journal
          ?.postingFingerprint;

      if (
        normalizedFingerprint
        &&
        normalizedFingerprint !==
          fingerprint
      ) {
        throw new PostingEngineError(
          'Ledger idempotency identity conflicts with an existing posting.',
          {
            code:
              POSTING_ERROR_CODES
                .IDEMPOTENCY_CONFLICT,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            operationType:
              request.operationType,

            idempotencyKey:
              request.idempotencyKey,

            journalId:
              existing.journal.id,
          },
        );
      }

      return {
        replay:
          true,

        completed:
          existing.journal.status ===
          'POSTED',

        result:
          this._mapExistingLedgerResult(
            existing,
          ),
      };
    } catch (error) {
      if (
        error?.code ===
        'LEDGER_JOURNAL_NOT_FOUND'
      ) {
        return null;
      }

      return null;
    }
  }

  _mapExistingLedgerResult(
    existing,
  ) {
    const journal =
      existing.journal ||
      {};

    const entries =
      existing.entries ||
      [];

    return {
      success:
        journal.status ===
        'POSTED',

      journalId:
        safeId(
          journal.id ||
          journal._id,
        ),

      postingReference:
        journal.postingReference ||
        journal.reference ||
        null,

      transactionId:
        safeId(
          journal.transactionId,
        ),

      tenantId:
        journal.tenantId,

      operationType:
        journal.operationType,

      status:
        journal.status,

      currency:
        journal.currency,

      accountingDate:
        journal.accountingDate,

      totalDebit:
        journal.totalDebit,

      totalCredit:
        journal.totalCredit,

      entryCount:
        entries.length,

      entries:
        entries.map(
          (
            entry,
          ) => ({
            id:
              safeId(
                entry.id ||
                entry._id,
              ),

            accountId:
              normalizeAccountId(
                entry.accountId,
              ),

            entryType:
              normalizeStatus(
                entry.entryType ||
                entry.type,
              ),

            amount:
              canonicalAmount(
                entry.amount,
                this.options
                  .maxDecimalPlaces,
              ),

            currency:
              normalizeCurrency(
                entry.currency,
              ),
          }),
        ),

      replay:
        true,
    };
  }

  async _reserveIdempotency(
    request,
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
        throw new PostingEngineError(
          'Idempotency service is required for production posting.',
          {
            code:
              POSTING_ERROR_CODES
                .IDEMPOTENCY_SERVICE_REQUIRED,

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

    try {
      const result =
        await this.idempotencyService
          .reserve(
            {
              tenantId:
                request.tenantId,

              operationType:
                request.operationType,

              key:
                request.idempotencyKey,

              operationId:
                request.operationId,

              request: {
                transactionId:
                  request.transactionId,

                operationType:
                  request.operationType,

                currency:
                  request.currency,

                accountingDate:
                  request.accountingDate,

                postingFingerprint:
                  command
                    .postingFingerprint,

                entries:
                  command.entries
                    .map(
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

              transactionId:
                request.transactionId,

              metadata:
                request.metadata,
            },
          );

      return result;
    } catch (error) {
      throw this._normalizePostingError(
        error,
        request,
        POSTING_ERROR_CODES
          .CONCURRENCY_CONFLICT,
      );
    }
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

    return this.idempotencyService
      .complete(
        operation.operationId,
        {
          ...result,

          postingFingerprint:
            result.postingFingerprint ||
            null,
        },
        {
          tenantId:
            request.tenantId,
        },
      );
  }

  async _handlePostingFailure(
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
                POSTING_ERROR_CODES
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
        'Posting idempotency failure state could not be persisted.',
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
   * Ledger Delegation
   * ======================================================================== */

  async _executeLedgerPost(
    command,
  ) {
    if (
      !this.ledgerEngine
    ) {
      throw new PostingEngineError(
        'LedgerEngine dependency is required.',
        {
          code:
            POSTING_ERROR_CODES
              .LEDGER_ENGINE_REQUIRED,

          statusCode:
            500,

          tenantId:
            command.tenantId,
        },
      );
    }

    const ledgerPayload = {
      ...command,

      operationId:
        command.operationId,

      tenantId:
        command.tenantId,

      operationType:
        command.operationType,

      idempotencyKey:
        command.idempotencyKey,

      entries:
        command.entries.map(
          (
            entry,
          ) => ({
            ...entry,

            type:
              entry.entryType,
          }),
        ),
    };

    try {
      let result;

      if (
        typeof this.ledgerEngine
          .post ===
        'function'
      ) {
        result =
          await this.ledgerEngine.post(
            ledgerPayload,
          );
      } else if (
        typeof this.ledgerEngine
          .postJournal ===
        'function'
      ) {
        result =
          await this.ledgerEngine
            .postJournal(
              ledgerPayload,
            );
      } else {
        throw new PostingEngineError(
          'LedgerEngine does not expose a supported posting API.',
          {
            code:
              POSTING_ERROR_CODES
                .LEDGER_ENGINE_REQUIRED,

            statusCode:
              500,
          },
        );
      }

      return this._normalizeLedgerResult(
        result,
        command,
      );
    } catch (error) {
      throw this._normalizePostingError(
        error,
        {
          tenantId:
            command.tenantId,

          operationType:
            command.operationType,

          idempotencyKey:
            command.idempotencyKey,

          transactionId:
            command.transactionId,
        },
      );
    }
  }

  _normalizeLedgerResult(
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
        value.success !== false,

      journalId:
        safeId(
          value.journalId ||
          value.journal?._id ||
          value.journal?.id,
        ),

      postingReference:
        normalizeString(
          value.postingReference ||
          value.journal
            ?.postingReference,
        ) ||
        command.postingReference,

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
        command.operationType,

      status:
        normalizeStatus(
          value.status ||
          value.journal?.status,
        ) ||
        POSTING_STATUS.POSTED,

      currency:
        normalizeCurrency(
          value.currency ||
          value.journal?.currency ||
          command.currency,
        ),

      accountingDate:
        value.accountingDate ||
        value.journal?.accountingDate ||
        command.accountingDate,

      totalDebit:
        canonicalAmount(
          value.totalDebit ||
          value.journal?.totalDebit ||
          command.totals.debitTotal,
          this.options
            .maxDecimalPlaces,
        ),

      totalCredit:
        canonicalAmount(
          value.totalCredit ||
          value.journal?.totalCredit ||
          command.totals.creditTotal,
          this.options
            .maxDecimalPlaces,
        ),

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
          ? value.entries.map(
              (
                entry,
              ) => ({
                id:
                  safeId(
                    entry.id ||
                    entry._id,
                  ),

                accountId:
                  normalizeAccountId(
                    entry.accountId,
                  ),

                entryType:
                  normalizeStatus(
                    entry.entryType ||
                    entry.type,
                  ),

                amount:
                  canonicalAmount(
                    entry.amount,
                    this.options
                      .maxDecimalPlaces,
                  ),

                currency:
                  normalizeCurrency(
                    entry.currency ||
                    command.currency,
                  ),

                sequence:
                  entry.sequence ||
                  null,
              }),
            )
          : command.entries.map(
              (
                entry,
              ) => ({
                id:
                  entry.id,

                accountId:
                  entry.accountId,

                entryType:
                  entry.entryType,

                amount:
                  entry.amount,

                currency:
                  entry.currency,

                sequence:
                  entry.sequence,
              }),
            ),

      source:
        value.source ||
        command.source,

      sourceId:
        safeId(
          value.sourceId ||
          command.sourceId,
        ),

      reversalOfJournalId:
        safeId(
          value.reversalOfJournalId ||
          command.reversalOfJournalId,
        ),

      reversalJournalId:
        safeId(
          value.reversalJournalId,
        ),

      createdAt:
        value.createdAt ||
        null,

      postedAt:
        value.postedAt ||
        null,

      updatedAt:
        value.updatedAt ||
        null,
    };
  }

  _buildReplayResult(
    existing,
  ) {
    if (
      existing.result
    ) {
      return {
        ...clone(
          existing.result,
        ),

        replay:
          true,

        postingEngineStatus:
          POSTING_STATUS.REPLAYED,
      };
    }

    if (
      existing.journal
    ) {
      return {
        ...this._normalizeLedgerResult(
          existing.journal,
          {
            tenantId:
              existing.journal.tenantId,

            operationType:
              existing.journal
                .operationType,

            currency:
              existing.journal.currency,

            postingReference:
              existing.journal
                .postingReference,

            totals: {
              debitTotal:
                existing.journal
                  .totalDebit,

              creditTotal:
                existing.journal
                  .totalCredit,
            },

            entries:
              existing.entries ||
              [],
          },
        ),

        replay:
          true,

        postingEngineStatus:
          POSTING_STATUS.REPLAYED,
      };
    }

    return {
      success:
        true,

      replay:
        true,

      postingEngineStatus:
        POSTING_STATUS.REPLAYED,
    };
  }

  /* ==========================================================================
   * Normalization
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

      operationType:
        normalizeStatus(
          value.operationType ||
          value.type,
        ),

      idempotencyKey:
        normalizeString(
          value.idempotencyKey ||
          value.idempotency_key,
        ),

      transactionId:
        safeId(
          value.transactionId,
        ),

      journalId:
        safeId(
          value.journalId,
        ),

      currency:
        normalizeCurrency(
          value.currency,
        ),

      accountingDate:
        value.accountingDate ||
        null,

      effectiveAt:
        value.effectiveAt ||
        null,

      description:
        normalizeString(
          value.description,
        ),

      reference:
        normalizeString(
          value.reference,
        ),

      externalReference:
        normalizeString(
          value.externalReference,
        ),

      source:
        normalizeString(
          value.source,
        ),

      sourceId:
        safeId(
          value.sourceId,
        ),

      reversalOfJournalId:
        safeId(
          value.reversalOfJournalId,
        ),

      reasonCode:
        normalizeString(
          value.reasonCode,
        ),

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

      metadata:
        this._sanitizeMetadata(
          value.metadata ||
          {},
        ),

      entries:
        Array.isArray(
          value.entries,
        )
          ? value.entries
          : [],
    };
  }

  _normalizeReversalRequest(
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

      idempotencyKey:
        normalizeString(
          value.idempotencyKey,
        ),

      reasonCode:
        normalizeString(
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
          value.createdBy,
        ),

      metadata:
        this._sanitizeMetadata(
          value.metadata ||
          {},
        ),
    };
  }

  /* ==========================================================================
   * Event / Audit
   * ======================================================================== */

  _eventTypeForResult(
    result,
    request,
  ) {
    if (
      request.operationType ===
      POSTING_OPERATION_TYPES
        .REVERSAL
    ) {
      return 'LedgerPostingReversalPosted';
    }

    if (
      request.operationType ===
      POSTING_OPERATION_TYPES
        .ADJUSTMENT
    ) {
      return 'LedgerAdjustmentPosted';
    }

    return 'LedgerPostingPosted';
  }

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
        `evt_posting_${crypto.randomUUID()}`,

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
        result?.journalId ||
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
        journalId:
          result?.journalId ||
          null,

        postingReference:
          result?.postingReference ||
          null,

        transactionId:
          result?.transactionId ||
          request.transactionId ||
          null,

        operationType:
          request.operationType,

        currency:
          result?.currency ||
          request.currency,

        totalDebit:
          result?.totalDebit ||
          null,

        totalCredit:
          result?.totalCredit ||
          null,

        entryCount:
          result?.entryCount ||
          0,

        status:
          result?.status ||
          null,

        reversalOfJournalId:
          result?.reversalOfJournalId ||
          null,
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

          journalId:
            result?.journalId ||
            null,

          idempotencyKey:
            request.idempotencyKey,
        },
      );

    try {
      if (
        typeof this.eventPublisher
          .publish ===
        'function'
      ) {
        return await this.eventPublisher.publish(
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
        'Ledger posting event publication failed.',
        error,
        {
          eventType,

          journalId:
            result?.journalId,

          tenantId:
            request.tenantId,
        },
      );

      if (
        this.options
          .failOnEventPublicationError
      ) {
        throw new PostingEngineError(
          'Ledger posting event publication failed.',
          {
            code:
              POSTING_ERROR_CODES
                .PERSISTENCE_ERROR,

            statusCode:
              503,

            tenantId:
              request.tenantId,

            journalId:
              result?.journalId,

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
        'LedgerPosting',

      resourceId:
        data.journalId ||
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
        'Ledger posting audit persistence failed.',
        error,
        {
          action,

          journalId:
            data.journalId ||
            null,

          tenantId:
            data.tenantId ||
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
   * Errors
   * ======================================================================== */

  _normalizePostingError(
    error,
    request,
    fallbackCode,
  ) {
    if (
      error instanceof
      PostingEngineError
    ) {
      return error;
    }

    if (
      error?.name ===
      'LedgerEngineError'
    ) {
      return new PostingEngineError(
        error.message ||
          'Ledger posting failed.',
        {
          code:
            error.code ||
            fallbackCode ||
            POSTING_ERROR_CODES
              .PERSISTENCE_ERROR,

          statusCode:
            Number(
              error.statusCode,
            ) || 500,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,

          idempotencyKey:
            request.idempotencyKey,

          transactionId:
            request.transactionId,

          journalId:
            error.journalId ||
            null,

          retryable:
            error.retryable ===
              true,

          unknownOutcome:
            error.unknownOutcome ===
              true,

          reconciliationRequired:
            error
              .reconciliationRequired ===
              true,

          details:
            error.details,

          cause:
            error,
        },
      );
    }

    return new PostingEngineError(
      error?.message ||
        'Ledger posting failed.',
      {
        code:
          fallbackCode ||
          error?.code ||
          POSTING_ERROR_CODES
            .PERSISTENCE_ERROR,

        statusCode:
          Number(
            error?.statusCode,
          ) || 503,

        tenantId:
          request.tenantId,

        operationType:
          request.operationType,

        idempotencyKey:
          request.idempotencyKey,

        transactionId:
          request.transactionId,

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

  /* ==========================================================================
   * Metadata / Observability
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
      // Never mask financial errors.
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
      // Metrics are non-authoritative.
    }
  }

  /* ==========================================================================
   * Configuration
   * ======================================================================== */

  getStatuses() {
    return Object.freeze({
      ...POSTING_STATUS,
    });
  }

  getEntryTypes() {
    return Object.freeze({
      ...ENTRY_TYPE,
    });
  }

  getOperationTypes() {
    return Object.freeze({
      ...POSTING_OPERATION_TYPES,
    });
  }

  getErrorCodes() {
    return Object.freeze({
      ...POSTING_ERROR_CODES,
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

      requireOperationType:
        this.options
          .requireOperationType,

      requireCurrency:
        this.options
          .requireCurrency,

      requireAccountingDate:
        this.options
          .requireAccountingDate,

      requireDoubleEntry:
        this.options
          .requireDoubleEntry,

      maxEntries:
        this.options.maxEntries,

      maxDecimalPlaces:
        this.options
          .maxDecimalPlaces,

      rejectMixedCurrencies:
        this.options
          .rejectMixedCurrencies,

      rejectZeroNetPostings:
        this.options
          .rejectZeroNetPostings,

      rejectInactiveAccounts:
        this.options
          .rejectInactiveAccounts,

      immutableHistory:
        this.options
          .immutableHistory,

      allowMultipleLinesPerAccount:
        this.options
          .allowMultipleLinesPerAccount,

      aggregateDuplicateAccounts:
        this.options
          .aggregateDuplicateAccounts,

      validateBeforeLedger:
        this.options
          .validateBeforeLedger,

      publishEvents:
        this.options.publishEvents,

      hasLedgerEngine:
        Boolean(
          this.ledgerEngine,
        ),

      hasAccountRepository:
        Boolean(
          this.accountRepository,
        ),

      hasAccountService:
        Boolean(
          this.accountService,
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
      && !this.ledgerEngine
    ) {
      errors.push(
        'ledgerEngine is required in strict mode.',
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
        'idempotencyService is required in strict mode.',
      );
    }

    if (
      this.options.strictMode
      &&
      this.options
        .validateBeforeLedger
      &&
      !this.accountRepository
      &&
      !this.accountService
    ) {
      errors.push(
        'accountRepository or accountService is required for pre-posting account validation.',
      );
    }

    return {
      valid:
        errors.length ===
        0,

      errors,
    };
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

PostingEngine.STATUS =
  POSTING_STATUS;

PostingEngine.POSTING_STATUS =
  POSTING_STATUS;

PostingEngine.ENTRY_TYPE =
  ENTRY_TYPE;

PostingEngine.OPERATION_TYPES =
  POSTING_OPERATION_TYPES;

PostingEngine.ERROR_CODES =
  POSTING_ERROR_CODES;

PostingEngine.ACCOUNT_STATUS =
  ACCOUNT_STATUS;

PostingEngine.PostingEngineError =
  PostingEngineError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createPostingEngine(
  dependencies = {},
) {
  return new PostingEngine(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  PostingEngine;

module.exports.PostingEngine =
  PostingEngine;

module.exports.PostingEngineError =
  PostingEngineError;

module.exports.createPostingEngine =
  createPostingEngine;

module.exports.POSTING_STATUS =
  POSTING_STATUS;

module.exports.ENTRY_TYPE =
  ENTRY_TYPE;

module.exports.POSTING_OPERATION_TYPES =
  POSTING_OPERATION_TYPES;

module.exports.POSTING_ERROR_CODES =
  POSTING_ERROR_CODES;

module.exports.ACCOUNT_STATUS =
  ACCOUNT_STATUS;

/* ============================================================================
 * End of File
 * ============================================================================
 */