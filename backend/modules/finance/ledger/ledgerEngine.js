'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Financial Ledger Engine
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/ledger/ledgerEngine.js
 *
 * Purpose
 * -------
 * Authoritative double-entry financial ledger orchestration boundary.
 *
 * This module is responsible for:
 *
 *   - validating financial posting requests
 *   - enforcing tenant isolation
 *   - enforcing idempotent financial posting
 *   - enforcing balanced double-entry journals
 *   - preventing mutation of immutable financial history
 *   - coordinating journal / journal-entry persistence
 *   - delegating posting-account logic to the configured account service
 *   - maintaining optimistic concurrency
 *   - supporting reversals through compensating entries
 *   - producing audit/event metadata
 *   - exposing deterministic posting results
 *
 * Core financial invariant
 * ------------------------
 *
 * For every committed journal:
 *
 *   SUM(DEBITS) === SUM(CREDITS)
 *
 * No financial posting is valid unless that invariant holds.
 *
 * Architecture
 * ------------
 *
 *   Payment / Loan / Contribution / Settlement
 *                    |
 *                    v
 *              Ledger Engine
 *                    |
 *          +---------+---------+
 *          |                   |
 *          v                   v
 *       Journal            Accounts
 *          |
 *          v
 *      JournalEntry
 *          |
 *          v
 *     Immutable Ledger
 *
 * Reversal
 * --------
 *
 * Original journal:
 *
 *   Debit  A     100
 *   Credit B     100
 *
 * NEVER edit original entries.
 *
 * Reversal journal:
 *
 *   Debit  B     100
 *   Credit A     100
 *
 * Posting rules
 * ------------
 * 1. Every financial operation enters through this engine.
 * 2. No direct balance mutation is performed here.
 * 3. No journal entry is deleted.
 * 4. No committed journal is edited to correct historical truth.
 * 5. Corrections are represented by compensating journals.
 * 6. Amounts are canonical decimal strings.
 * 7. Currency must be explicit.
 * 8. Tenant ID is mandatory in production.
 * 9. Idempotency is mandatory in production.
 * 10. Duplicate posting requests return the authoritative original result.
 * 11. Reusing an idempotency key with a different semantic payload is rejected.
 * 12. Every journal must have at least one debit and one credit.
 * 13. A journal must balance exactly.
 * 14. Account ownership/tenant boundaries are validated.
 * 15. Account status must permit posting.
 * 16. Historical ledger state is immutable.
 * 17. Persistence must use transaction/session support where available.
 * 18. Atomic version checks protect concurrent posting.
 * 19. Observability must never change financial correctness.
 * 20. Financial side effects must be recoverable and auditable.
 *
 * ============================================================================
 */

/* ============================================================================
 * Dependencies
 * ========================================================================== */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

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

const LEDGER_OPERATION_TYPES = Object.freeze({
  POST:
    'POST',

  REVERSAL:
    'REVERSAL',

  ADJUSTMENT:
    'ADJUSTMENT',

  SETTLEMENT:
    'SETTLEMENT',

  LOAN_DISBURSEMENT:
    'LOAN_DISBURSEMENT',

  LOAN_REPAYMENT:
    'LOAN_REPAYMENT',

  CONTRIBUTION:
    'CONTRIBUTION',

  WITHDRAWAL:
    'WITHDRAWAL',

  TRANSFER:
    'TRANSFER',

  FEE:
    'FEE',

  INTEREST:
    'INTEREST',

  WRITE_OFF:
    'WRITE_OFF',

  REFUND:
    'REFUND',
});

const LEDGER_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'LEDGER_INVALID_REQUEST',

  TENANT_REQUIRED:
    'LEDGER_TENANT_REQUIRED',

  OPERATION_TYPE_REQUIRED:
    'LEDGER_OPERATION_TYPE_REQUIRED',

  IDEMPOTENCY_REQUIRED:
    'LEDGER_IDEMPOTENCY_REQUIRED',

  INVALID_CURRENCY:
    'LEDGER_INVALID_CURRENCY',

  INVALID_AMOUNT:
    'LEDGER_INVALID_AMOUNT',

  INVALID_ENTRY:
    'LEDGER_INVALID_ENTRY',

  ENTRIES_REQUIRED:
    'LEDGER_ENTRIES_REQUIRED',

  DEBIT_REQUIRED:
    'LEDGER_DEBIT_REQUIRED',

  CREDIT_REQUIRED:
    'LEDGER_CREDIT_REQUIRED',

  ZERO_AMOUNT:
    'LEDGER_ZERO_AMOUNT',

  BALANCE_MISMATCH:
    'LEDGER_BALANCE_MISMATCH',

  TOO_MANY_DECIMALS:
    'LEDGER_TOO_MANY_DECIMALS',

  DUPLICATE_ACCOUNT:
    'LEDGER_DUPLICATE_ACCOUNT',

  ACCOUNT_REQUIRED:
    'LEDGER_ACCOUNT_REQUIRED',

  ACCOUNT_NOT_FOUND:
    'LEDGER_ACCOUNT_NOT_FOUND',

  ACCOUNT_INACTIVE:
    'LEDGER_ACCOUNT_INACTIVE',

  ACCOUNT_TENANT_MISMATCH:
    'LEDGER_ACCOUNT_TENANT_MISMATCH',

  ACCOUNT_CURRENCY_MISMATCH:
    'LEDGER_ACCOUNT_CURRENCY_MISMATCH',

  JOURNAL_NOT_FOUND:
    'LEDGER_JOURNAL_NOT_FOUND',

  JOURNAL_ALREADY_POSTED:
    'LEDGER_JOURNAL_ALREADY_POSTED',

  JOURNAL_ALREADY_REVERSED:
    'LEDGER_JOURNAL_ALREADY_REVERSED',

  IMMUTABLE_JOURNAL:
    'LEDGER_IMMUTABLE_JOURNAL',

  IMMUTABLE_ENTRY:
    'LEDGER_IMMUTABLE_ENTRY',

  IDEMPOTENCY_CONFLICT:
    'LEDGER_IDEMPOTENCY_CONFLICT',

  CONCURRENT_UPDATE:
    'LEDGER_CONCURRENT_UPDATE',

  TRANSACTION_REQUIRED:
    'LEDGER_TRANSACTION_REQUIRED',

  TRANSACTION_UNAVAILABLE:
    'LEDGER_TRANSACTION_UNAVAILABLE',

  PERSISTENCE_UNAVAILABLE:
    'LEDGER_PERSISTENCE_UNAVAILABLE',

  REVERSAL_REASON_REQUIRED:
    'LEDGER_REVERSAL_REASON_REQUIRED',

  REVERSAL_SELF_REFERENCE:
    'LEDGER_REVERSAL_SELF_REFERENCE',

  REVERSAL_ALREADY_EXISTS:
    'LEDGER_REVERSAL_ALREADY_EXISTS',

  INVALID_REVERSAL:
    'LEDGER_INVALID_REVERSAL',

  PERIOD_CLOSED:
    'LEDGER_PERIOD_CLOSED',

  DATE_INVALID:
    'LEDGER_DATE_INVALID',

  ACCOUNTING_DATE_REQUIRED:
    'LEDGER_ACCOUNTING_DATE_REQUIRED',

  CONFIGURATION_ERROR:
    'LEDGER_CONFIGURATION_ERROR',
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

  allowNegativeAmounts:
    false,

  maxEntries:
    100,

  maxDescriptionLength:
    1000,

  maxReferenceLength:
    255,

  maxDecimalPlaces:
    2,

  /**
   * Production ledger posting should be atomic.
   */
  requireAtomicPersistence:
    true,

  /**
   * Historical financial records remain immutable.
   */
  immutableHistory:
    true,

  /**
   * Account state must be validated before journal commit.
   */
  validateAccounts:
    true,

  /**
   * Journal must have explicit debit and credit lines.
   */
  requireBalancedDoubleEntry:
    true,

  /**
   * Multiple lines to the same account are allowed by default, although
   * consumers may pre-aggregate them if desired.
   */
  allowMultipleLinesPerAccount:
    true,

  /**
   * Duplicate account/currency combinations are still independently recorded
   * if they represent different business events.
   */
  enforceSingleJournalCurrency:
    true,

  /**
   * A reversal must be a new journal.
   */
  reversalCreatesCompensatingJournal:
    true,

  /**
   * Events are supplementary to persistence and should preferably be delivered
   * through an outbox.
   */
  publishEvents:
    true,

  failOnEventPublicationError:
    false,

  /**
   * Audit is operationally important but must not break an already committed
   * transaction.
   */
  failOnAuditError:
    false,

  retainRequestMetadata:
    true,

  maxMetadataDepth:
    8,

  maxMetadataKeys:
    100,

  maxMetadataStringLength:
    5000,
});

/* ============================================================================
 * Errors
 * ========================================================================== */

class LedgerEngineError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'LedgerEngineError';

    this.code =
      options.code ||
      LEDGER_ERROR_CODES
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

    this.journalId =
      options.journalId ||
      null;

    this.transactionId =
      options.transactionId ||
      null;

    this.reversalJournalId =
      options.reversalJournalId ||
      null;

    this.retryable =
      options.retryable === true;

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
      LedgerEngineError,
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

function normalizeAccountId(
  value,
) {
  if (
    value &&
    typeof value === 'object' &&
    value._id
  ) {
    return safeId(
      value._id,
    );
  }

  return safeId(
    value,
  );
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
      // Continue below.
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
    Number(
      value,
    );

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

/**
 * Decimal arithmetic without JavaScript floating point.
 *
 * The engine converts amounts to scaled integers based on maxDecimalPlaces.
 * This is suitable for ordinary fiat accounting where the configured scale is
 * fixed. For currencies with non-standard scales, configure the engine/service
 * accordingly or perform a currency-specific normalization upstream.
 */
function decimalToScaledInteger(
  value,
  scale,
) {
  const amount =
    normalizeString(
      String(
        value,
      ),
    );

  if (
    !amount
  ) {
    return null;
  }

  if (
    !/^\d+(\.\d+)?$/.test(
      amount,
    )
  ) {
    return null;
  }

  const [
    integerPart,
    fractionPart = '',
  ] =
    amount.split('.');

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
      padded ||
        '0',
    )
  );
}

function scaledIntegerToDecimal(
  value,
  scale,
) {
  const number =
    BigInt(
      value,
    );

  const divisor =
    10n ** BigInt(scale);

  const whole =
    number / divisor;

  const fraction =
    number % divisor;

  if (
    scale === 0
  ) {
    return whole.toString();
  }

  const fractionText =
    fraction
      .toString()
      .padStart(
        scale,
        '0',
      )
      .replace(
        /0+$/,
        '',
      );

  return fractionText
    ? `${whole.toString()}.${fractionText}`
    : whole.toString();
}

function canonicalAmount(
  value,
  options = DEFAULT_OPTIONS,
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
      options.maxDecimalPlaces,
    );

  if (
    scaled === null
  ) {
    return null;
  }

  return scaledIntegerToDecimal(
    scaled,
    options.maxDecimalPlaces,
  );
}

function compareAmounts(
  a,
  b,
  scale,
) {
  const left =
    decimalToScaledInteger(
      a,
      scale,
    );

  const right =
    decimalToScaledInteger(
      b,
      scale,
    );

  if (
    left === null ||
    right === null
  ) {
    return null;
  }

  if (
    left === right
  ) {
    return 0;
  }

  return left > right
    ? 1
    : -1;
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

function createJournalId() {
  return `journal_${crypto.randomUUID()}`;
}

function createEntryId() {
  return `journal_entry_${crypto.randomUUID()}`;
}

function createPostingReference() {
  const timestamp =
    Date.now()
      .toString(36)
      .toUpperCase();

  const random =
    crypto.randomBytes(4)
      .toString('hex')
      .toUpperCase();

  return `GL-${timestamp}-${random}`;
}

/* ============================================================================
 * Ledger Engine
 * ========================================================================== */

class LedgerEngine {
  /**
   * Recommended dependencies:
   *
   *   journalRepository
   *   journalEntryRepository
   *   accountRepository
   *   accountService
   *   transactionManager
   *   idempotencyService
   *   periodCloseService
   *   eventPublisher
   *   auditService
   *   metrics
   *   logger
   *
   * The engine intentionally tolerates common repository method naming
   * conventions to integrate with the existing architecture without requiring
   * folder restructuring.
   */
  constructor(
    dependencies = {},
  ) {
    this.journalRepository =
      dependencies.journalRepository ||
      dependencies.journalRepo ||
      null;

    this.journalEntryRepository =
      dependencies.journalEntryRepository ||
      dependencies.entryRepository ||
      null;

    this.accountRepository =
      dependencies.accountRepository ||
      null;

    this.accountService =
      dependencies.accountService ||
      null;

    this.transactionManager =
      dependencies.transactionManager ||
      dependencies.mongoTransactionManager ||
      null;

    this.idempotencyService =
      dependencies.idempotencyService ||
      null;

    this.periodCloseService =
      dependencies.periodCloseService ||
      null;

    this.eventPublisher =
      dependencies.eventPublisher ||
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
   * Primary Posting API
   * ======================================================================== */

  /**
   * Post a balanced journal.
   *
   * Example:
   *
   * await ledgerEngine.post({
   *   tenantId,
   *   operationType: 'CONTRIBUTION',
   *   idempotencyKey,
   *   transactionId,
   *   currency: 'UGX',
   *   accountingDate: '2026-08-16',
   *   description: 'Member contribution',
   *   entries: [
   *     {
   *       accountId: cashAccountId,
   *       type: 'DEBIT',
   *       amount: '100000'
   *     },
   *     {
   *       accountId: memberContributionAccountId,
   *       type: 'CREDIT',
   *       amount: '100000'
   *     }
   *   ]
   * });
   */
  async post(
    input = {},
  ) {
    const request =
      this._normalizePostingRequest(
        input,
      );

    this._validatePostingRequest(
      request,
    );

    const existing =
      await this._findExistingByIdempotency(
        request,
      );

    if (
      existing
    ) {
      return this._buildPostingResult(
        existing.journal,
        existing.entries,
        {
          replay:
            true,
        },
      );
    }

    const accountContext =
      await this._validateAccounts(
        request,
      );

    await this._validateAccountingPeriod(
      request,
      accountContext,
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

    const postingPlan =
      this._buildPostingPlan(
        request,
        normalizedEntries,
        accountContext,
      );

    const operation =
      await this._reserveIdempotency(
        request,
        postingPlan,
      );

    if (
      operation?.completed
      && operation.result
    ) {
      return operation.result;
    }

    let result;

    try {
      result =
        await this._persistPosting(
          request,
          postingPlan,
          operation,
        );
    } catch (error) {
      await this._handlePostingFailure(
        request,
        operation,
        error,
      );

      throw error instanceof
        LedgerEngineError
        ? error
        : this._wrapPersistenceError(
            error,
            request,
          );
    }

    await this._completeIdempotency(
      operation,
      result,
      request,
    );

    await this._publishPostingEvent(
      result,
      request,
    );

    await this._recordAuditSafe(
      'LEDGER_POSTED',
      {
        ...request,

        journalId:
          result.journalId,

        postingReference:
          result.postingReference,
      },
    );

    this._metric(
      'ledger_postings_total',
      1,
      {
        operationType:
          request.operationType,
        currency:
          request.currency,
      },
    );

    return result;
  }

  /**
   * Alias retained for callers that use "postJournal".
   */
  async postJournal(
    input = {},
  ) {
    return this.post(
      input,
    );
  }

  /**
   * Alias retained for callers that use "createJournal".
   *
   * This method POSTS immediately. It does not create a mutable draft.
   */
  async createJournal(
    input = {},
  ) {
    return this.post(
      input,
    );
  }

  /* ==========================================================================
   * Reversal API
   * ======================================================================== */

  /**
   * Create an immutable compensating journal for an already-posted journal.
   */
  async reverseJournal(
    input = {},
  ) {
    const request =
      this._normalizeReversalRequest(
        input,
      );

    this._validateReversalRequest(
      request,
    );

    const original =
      await this._loadJournalAggregate(
        request.journalId ||
          request.originalJournalId,
        request,
      );

    this._validateOriginalForReversal(
      original,
      request,
    );

    const reversalIdempotencyKey =
      request.idempotencyKey ||
      `reversal:${original.journal.id}`;

    const reversalEntries =
      this._buildReversalEntries(
        original.entries,
      );

    const reversalRequest = {
      tenantId:
        request.tenantId,

      operationType:
        LEDGER_OPERATION_TYPES
          .REVERSAL,

      idempotencyKey:
        reversalIdempotencyKey,

      transactionId:
        request.transactionId ||
        null,

      currency:
        original.journal.currency,

      accountingDate:
        request.accountingDate ||
        original.journal.accountingDate,

      description:
        request.description ||
        `Reversal of journal ${original.journal.id}`,

      reference:
        request.reference ||
        createPostingReference(),

      source:
        'REVERSAL',

      sourceId:
        original.journal.id,

      reversalOfJournalId:
        original.journal.id,

      reasonCode:
        request.reasonCode,

      metadata:
        {
          ...(request.metadata || {}),
          originalJournalId:
            original.journal.id,
        },

      entries:
        reversalEntries,
    };

    const result =
      await this.post(
        reversalRequest,
      );

    /**
     * Mark the original journal as REVERSED only after the compensating journal
     * itself has been durably committed.
     *
     * This update is an operational link/state marker. It does not mutate
     * original financial entries.
     */
    await this._markJournalReversed(
      original.journal,
      result.journalId,
      request,
    );

    return {
      ...result,

      reversalOfJournalId:
        original.journal.id,

      originalJournalId:
        original.journal.id,

      originalStatus:
        JOURNAL_STATUS.REVERSED,
    };
  }

  async reverseTransaction(
    input = {},
  ) {
    if (
      !input.journalId &&
      !input.transactionId
    ) {
      throw new LedgerEngineError(
        'Either journalId or transactionId is required for reversal.',
        {
          code:
            LEDGER_ERROR_CODES
              .INVALID_REVERSAL,

          statusCode:
            400,

          tenantId:
            input.tenantId ||
            null,
        },
      );
    }

    if (
      input.journalId
    ) {
      return this.reverseJournal(
        input,
      );
    }

    const journal =
      await this._findJournalByTransactionId(
        input.transactionId,
        input.tenantId,
      );

    if (
      !journal
    ) {
      throw new LedgerEngineError(
        'No journal was found for the supplied transaction.',
        {
          code:
            LEDGER_ERROR_CODES
              .JOURNAL_NOT_FOUND,

          statusCode:
            404,

          tenantId:
            input.tenantId ||
            null,

          transactionId:
            input.transactionId,
        },
      );
    }

    return this.reverseJournal({
      ...input,

      journalId:
        safeId(
          journal._id ||
            journal.id,
        ),
    });
  }

  async createAdjustmentEntry(
    input = {},
  ) {
    const request =
      {
        ...input,

        operationType:
          LEDGER_OPERATION_TYPES
            .ADJUSTMENT,

        source:
          input.source ||
          'ADJUSTMENT',
      };

    return this.post(
      request,
    );
  }

  /* ==========================================================================
   * Journal Retrieval
   * ======================================================================== */

  async getJournal(
    journalId,
    context = {},
  ) {
    const id =
      safeId(
        journalId,
      );

    if (
      !id
    ) {
      throw new LedgerEngineError(
        'Journal ID is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .JOURNAL_NOT_FOUND,

          statusCode:
            400,

          tenantId:
            context.tenantId ||
            null,
        },
      );
    }

    return this._loadJournalAggregate(
      id,
      {
        tenantId:
          context.tenantId,
      },
    );
  }

  async getJournalByIdempotencyKey(
    input = {},
  ) {
    const request =
      this._normalizePostingRequest(
        input,
      );

    this._validateTenantAndIdempotency(
      request,
    );

    const existing =
      await this._findExistingByIdempotency(
        request,
      );

    if (
      !existing
    ) {
      throw new LedgerEngineError(
        'No journal exists for the supplied idempotency identity.',
        {
          code:
            LEDGER_ERROR_CODES
              .JOURNAL_NOT_FOUND,

          statusCode:
            404,

          tenantId:
            request.tenantId,

          idempotencyKey:
            request.idempotencyKey,
        },
      );
    }

    return existing;
  }

  /* ==========================================================================
   * Validation
   * ======================================================================== */

  _validatePostingRequest(
    request,
  ) {
    this._validateTenantAndIdempotency(
      request,
    );

    if (
      this.options.requireOperationType
      && !request.operationType
    ) {
      throw new LedgerEngineError(
        'Operation type is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .OPERATION_TYPE_REQUIRED,

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
      throw new LedgerEngineError(
        'Currency is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .INVALID_CURRENCY,

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
      throw new LedgerEngineError(
        'Currency must be a three-letter ISO-style currency code.',
        {
          code:
            LEDGER_ERROR_CODES
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
      && !request.accountingDate
    ) {
      throw new LedgerEngineError(
        'Accounting date is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .ACCOUNTING_DATE_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.accountingDate
      && !parseDate(
        request.accountingDate,
      )
    ) {
      throw new LedgerEngineError(
        'Accounting date is invalid.',
        {
          code:
            LEDGER_ERROR_CODES
              .DATE_INVALID,

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
      || !request.entries.length
    ) {
      throw new LedgerEngineError(
        'At least one journal entry is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .ENTRIES_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.entries.length >
      this.options.maxEntries
    ) {
      throw new LedgerEngineError(
        `A journal may contain at most ${this.options.maxEntries} entries.`,
        {
          code:
            LEDGER_ERROR_CODES
              .INVALID_ENTRY,

          statusCode:
            400,

          tenantId:
            request.tenantId,

          details: {
            maximum:
              this.options.maxEntries,
          },
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
      throw new LedgerEngineError(
        'Journal description is too long.',
        {
          code:
            LEDGER_ERROR_CODES
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
      throw new LedgerEngineError(
        'Journal reference is too long.',
        {
          code:
            LEDGER_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }
  }

  _validateTenantAndIdempotency(
    request,
  ) {
    if (
      this.options.requireTenant
      && !request.tenantId
    ) {
      throw new LedgerEngineError(
        'Tenant ID is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,
        },
      );
    }

    if (
      this.options.requireIdempotency
      && !request.idempotencyKey
    ) {
      throw new LedgerEngineError(
        'Ledger idempotency key is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .IDEMPOTENCY_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }
  }

  _validateDoubleEntry(
    entries,
    currency,
  ) {
    if (
      !entries.length
    ) {
      throw new LedgerEngineError(
        'Journal entries are required.',
        {
          code:
            LEDGER_ERROR_CODES
              .ENTRIES_REQUIRED,
        },
      );
    }

    let debitTotal =
      0n;

    let creditTotal =
      0n;

    let debitCount =
      0;

    let creditCount =
      0;

    const scale =
      this.options
        .maxDecimalPlaces;

    for (
      const entry of
        entries
    ) {
      if (
        !entry.accountId
      ) {
        throw new LedgerEngineError(
          'Every journal entry must reference an account.',
          {
            code:
              LEDGER_ERROR_CODES
                .ACCOUNT_REQUIRED,
          },
        );
      }

      if (
        ![
          ENTRY_TYPE.DEBIT,
          ENTRY_TYPE.CREDIT,
        ].includes(
          entry.entryType,
        )
      ) {
        throw new LedgerEngineError(
          'Journal entry type must be DEBIT or CREDIT.',
          {
            code:
              LEDGER_ERROR_CODES
                .INVALID_ENTRY,

            details: {
              accountId:
                entry.accountId,
            },
          },
        );
      }

      const amount =
        decimalToScaledInteger(
          entry.amount,
          scale,
        );

      if (
        amount === null
      ) {
        throw new LedgerEngineError(
          'Journal entry amount is invalid.',
          {
            code:
              LEDGER_ERROR_CODES
                .INVALID_AMOUNT,

            details: {
              accountId:
                entry.accountId,
              amount:
                entry.amount,
            },
          },
        );
      }

      if (
        amount <=
        0n
      ) {
        throw new LedgerEngineError(
          'Journal entry amount must be greater than zero.',
          {
            code:
              LEDGER_ERROR_CODES
                .ZERO_AMOUNT,

            details: {
              accountId:
                entry.accountId,
            },
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
      } else {
        creditCount +=
          1;

        creditTotal +=
          amount;
      }

      if (
        normalizeCurrency(
          entry.currency ||
            currency,
        ) !==
        currency
      ) {
        throw new LedgerEngineError(
          'All journal entries must use the journal currency.',
          {
            code:
              LEDGER_ERROR_CODES
                .ACCOUNT_CURRENCY_MISMATCH,

            details: {
              entryCurrency:
                entry.currency,
              journalCurrency:
                currency,
              accountId:
                entry.accountId,
            },
          },
        );
      }
    }

    if (
      this.options
        .requireBalancedDoubleEntry
    ) {
      if (
        debitCount ===
        0
      ) {
        throw new LedgerEngineError(
          'Journal must contain at least one debit entry.',
          {
            code:
              LEDGER_ERROR_CODES
                .DEBIT_REQUIRED,
          },
        );
      }

      if (
        creditCount ===
        0
      ) {
        throw new LedgerEngineError(
          'Journal must contain at least one credit entry.',
          {
            code:
              LEDGER_ERROR_CODES
                .CREDIT_REQUIRED,
          },
        );
      }

      if (
        debitTotal !==
        creditTotal
      ) {
        throw new LedgerEngineError(
          'Journal debits and credits are not balanced.',
          {
            code:
              LEDGER_ERROR_CODES
                .BALANCE_MISMATCH,

            details: {
              debitTotal:
                scaledIntegerToDecimal(
                  debitTotal,
                  scale,
                ),

              creditTotal:
                scaledIntegerToDecimal(
                  creditTotal,
                  scale,
                ),
            },
          },
        );
      }
    }
  }

  _validateReversalRequest(
    request,
  ) {
    if (
      this.options.requireTenant
      && !request.tenantId
    ) {
      throw new LedgerEngineError(
        'Tenant ID is required for reversal.',
        {
          code:
            LEDGER_ERROR_CODES
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
    ) {
      throw new LedgerEngineError(
        'Original journal ID is required for reversal.',
        {
          code:
            LEDGER_ERROR_CODES
              .JOURNAL_NOT_FOUND,

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
      throw new LedgerEngineError(
        'Reversal idempotency key is required.',
        {
          code:
            LEDGER_ERROR_CODES
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
      throw new LedgerEngineError(
        'A reversal reason code is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .REVERSAL_REASON_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }
  }

  _validateOriginalForReversal(
    aggregate,
    request,
  ) {
    if (
      !aggregate ||
      !aggregate.journal
    ) {
      throw new LedgerEngineError(
        'Original journal was not found.',
        {
          code:
            LEDGER_ERROR_CODES
              .JOURNAL_NOT_FOUND,

          statusCode:
            404,

          tenantId:
            request.tenantId,

          journalId:
            request.journalId ||
            request.originalJournalId,
        },
      );
    }

    if (
      aggregate.journal.tenantId
      &&
      aggregate.journal.tenantId !==
        request.tenantId
    ) {
      throw new LedgerEngineError(
        'Original journal belongs to a different tenant.',
        {
          code:
            LEDGER_ERROR_CODES
              .ACCOUNT_TENANT_MISMATCH,

          statusCode:
            403,

          tenantId:
            request.tenantId,

          journalId:
            aggregate.journal.id,
        },
      );
    }

    const status =
      normalizeStatus(
        aggregate.journal.status,
      );

    if (
      status ===
      JOURNAL_STATUS.REVERSED
      &&
      aggregate.journal
        .reversalJournalId
    ) {
      throw new LedgerEngineError(
        'Journal has already been reversed.',
        {
          code:
            LEDGER_ERROR_CODES
              .JOURNAL_ALREADY_REVERSED,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          journalId:
            aggregate.journal.id,

          reversalJournalId:
            aggregate.journal
              .reversalJournalId,
        },
      );
    }

    if (
      status !==
      JOURNAL_STATUS.POSTED
    ) {
      throw new LedgerEngineError(
        'Only POSTED journals may be reversed.',
        {
          code:
            LEDGER_ERROR_CODES
              .IMMUTABLE_JOURNAL,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          journalId:
            aggregate.journal.id,
        },
      );
    }

    if (
      aggregate.journal.sourceId
      &&
      aggregate.journal.sourceId ===
        request.journalId
    ) {
      throw new LedgerEngineError(
        'A journal cannot reverse itself.',
        {
          code:
            LEDGER_ERROR_CODES
              .REVERSAL_SELF_REFERENCE,

          statusCode:
            409,

          tenantId:
            request.tenantId,

          journalId:
            aggregate.journal.id,
        },
      );
    }
  }

  /* ==========================================================================
   * Entry Normalization
   * ======================================================================== */

  _normalizeEntries(
    entries,
    currency,
  ) {
    return entries.map(
      (
        entry,
        index,
      ) => {
        if (
          !entry ||
          typeof entry !==
            'object'
        ) {
          throw new LedgerEngineError(
            `Journal entry ${index + 1} is invalid.`,
            {
              code:
                LEDGER_ERROR_CODES
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

        const entryType =
          normalizeStatus(
            entry.entryType ||
              entry.type,
          );

        const amount =
          canonicalAmount(
            entry.amount,
            this.options,
          );

        if (
          !accountId
        ) {
          throw new LedgerEngineError(
            `Journal entry ${index + 1} has no account.`,
            {
              code:
                LEDGER_ERROR_CODES
                  .ACCOUNT_REQUIRED,

              details: {
                index,
              },
            },
          );
        }

        if (
          ![
            ENTRY_TYPE.DEBIT,
            ENTRY_TYPE.CREDIT,
          ].includes(
            entryType,
          )
        ) {
          throw new LedgerEngineError(
            `Journal entry ${index + 1} has an invalid entry type.`,
            {
              code:
                LEDGER_ERROR_CODES
                  .INVALID_ENTRY,

              details: {
                index,
                entryType,
              },
            },
          );
        }

        if (
          !amount
        ) {
          throw new LedgerEngineError(
            `Journal entry ${index + 1} has an invalid amount.`,
            {
              code:
                LEDGER_ERROR_CODES
                  .INVALID_AMOUNT,

              details: {
                index,
                accountId,
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
            createEntryId(),

          accountId,

          entryType,

          type:
            entryType,

          amount,

          currency:
            normalizeCurrency(
              entry.currency ||
                currency,
            ),

          description:
            normalizeString(
              entry.description,
            ),

          reference:
            normalizeString(
              entry.reference,
            ),

          sequence:
            index + 1,

          metadata:
            this._sanitizeMetadata(
              entry.metadata,
            ),
        };
      },
    );
  }

  _buildPostingPlan(
    request,
    entries,
    accounts,
  ) {
    const postingReference =
      request.reference ||
      createPostingReference();

    const journalId =
      request.journalId ||
      createJournalId();

    const journal = {
      id:
        journalId,

      tenantId:
        request.tenantId,

      operationType:
        request.operationType,

      transactionId:
        request.transactionId ||
        null,

      idempotencyKey:
        request.idempotencyKey,

      postingReference,

      externalReference:
        request.externalReference ||
        null,

      status:
        JOURNAL_STATUS.POSTING,

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

      reversalJournalId:
        null,

      totalDebit:
        sumAmounts(
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
            ),
          this.options
            .maxDecimalPlaces,
        ),

      totalCredit:
        sumAmounts(
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
            ),
          this.options
            .maxDecimalPlaces,
        ),

      entryCount:
        entries.length,

      version:
        0,

      metadata:
        this.options
          .retainRequestMetadata
          ? this._sanitizeMetadata(
              request.metadata,
            )
          : {},

      createdAt:
        now(),

      updatedAt:
        now(),

      createdBy:
        request.actorId ||
        null,
    };

    return {
      journal,

      entries,

      accounts,

      postingReference,
    };
  }

  /* ==========================================================================
   * Account Validation
   * ======================================================================== */

  async _validateAccounts(
    request,
  ) {
    if (
      !this.options
        .validateAccounts
    ) {
      return [];
    }

    const accountIds =
      request.entries.map(
        (
          entry,
        ) =>
          normalizeAccountId(
            entry.accountId ||
              entry.account,
          ),
      );

    const uniqueAccountIds =
      [
        ...new Set(
          accountIds,
        ),
      ];

    if (
      !this.accountRepository
      && !this.accountService
    ) {
      if (
        this.options.strictMode
      ) {
        throw new LedgerEngineError(
          'Account repository/service is required for ledger posting.',
          {
            code:
              LEDGER_ERROR_CODES
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
        uniqueAccountIds,
        request,
      );

    if (
      accounts.length !==
      uniqueAccountIds.length
    ) {
      const found =
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
        uniqueAccountIds.filter(
          (
            id,
          ) =>
            !found.has(
              id,
            ),
        );

      throw new LedgerEngineError(
        'One or more ledger accounts could not be found.',
        {
          code:
            LEDGER_ERROR_CODES
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
        throw new LedgerEngineError(
          'Ledger account belongs to a different tenant.',
          {
            code:
              LEDGER_ERROR_CODES
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
                ? ACCOUNT_STATUS
                    .CLOSED
                : ACCOUNT_STATUS
                    .ACTIVE
            ),
        );

      if (
        [
          ACCOUNT_STATUS.FROZEN,
          ACCOUNT_STATUS.BLOCKED,
          ACCOUNT_STATUS.CLOSED,
          ACCOUNT_STATUS.SUSPENDED,
        ].includes(
          status,
        )
      ) {
        throw new LedgerEngineError(
          'Ledger account does not permit financial posting.',
          {
            code:
              LEDGER_ERROR_CODES
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

      const accountCurrency =
        normalizeCurrency(
          account.currency,
        );

      if (
        accountCurrency
        &&
        accountCurrency !==
          request.currency
      ) {
        throw new LedgerEngineError(
          'Ledger account currency does not match the journal currency.',
          {
            code:
              LEDGER_ERROR_CODES
                .ACCOUNT_CURRENCY_MISMATCH,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            details: {
              accountId,

              accountCurrency,

              journalCurrency:
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
    request,
  ) {
    const query = {
      tenantId:
        request.tenantId,

      ids:
        accountIds,
    };

    if (
      this.accountService
      && typeof this.accountService
        .getAccountsByIds ===
        'function'
    ) {
      const accounts =
        await this.accountService
          .getAccountsByIds(
            accountIds,
            {
              tenantId:
                request.tenantId,
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
      && typeof this.accountRepository
        .findByIds ===
        'function'
    ) {
      const accounts =
        await this.accountRepository
          .findByIds(
            accountIds,
            {
              tenantId:
                request.tenantId,
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
      && typeof this.accountRepository
        .findById ===
        'function'
    ) {
      const accounts = [];

      for (
        const id of
          accountIds
      ) {
        const account =
          await this.accountRepository
            .findById(
              id,
              {
                tenantId:
                  request.tenantId,
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
      && typeof this.accountRepository
        .find ===
        'function'
    ) {
      const accounts =
        await this.accountRepository
          .find(
            query,
          );

      return Array.isArray(
        accounts,
      )
        ? accounts
        : [];
    }

    throw new LedgerEngineError(
      'Account repository/service does not expose a supported lookup method.',
      {
        code:
          LEDGER_ERROR_CODES
            .PERSISTENCE_UNAVAILABLE,

        statusCode:
          500,

        tenantId:
          request.tenantId,
      },
    );
  }

  /* ==========================================================================
   * Accounting Period
   * ======================================================================== */

  async _validateAccountingPeriod(
    request,
    accountContext,
  ) {
    if (
      !this.periodCloseService
    ) {
      return true;
    }

    const accountingDate =
      parseDate(
        request.accountingDate,
      );

    if (
      !accountingDate
    ) {
      throw new LedgerEngineError(
        'Valid accounting date is required.',
        {
          code:
            LEDGER_ERROR_CODES
              .DATE_INVALID,

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
      const result =
        await this.periodCloseService
          .assertOpen(
            {
              tenantId:
                request.tenantId,

              accountingDate,
            },
            request.persistenceContext,
          );

      if (
        result === false
      ) {
        throw new LedgerEngineError(
          'Accounting period is closed.',
          {
            code:
              LEDGER_ERROR_CODES
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

              accountingDate,
            },
          );

      if (
        closed
      ) {
        throw new LedgerEngineError(
          'Accounting period is closed.',
          {
            code:
              LEDGER_ERROR_CODES
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
   * Persistence
   * ======================================================================== */

  async _persistPosting(
    request,
    postingPlan,
    operation,
  ) {
    if (
      !this.journalRepository
    ) {
      throw new LedgerEngineError(
        'Journal repository is unavailable.',
        {
          code:
            LEDGER_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            503,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      this.options
        .requireAtomicPersistence
      &&
      !this.transactionManager
      &&
      !request.persistenceContext
    ) {
      /**
       * A repository itself may internally provide atomic transaction support.
       * We therefore allow a repository transaction callback if it exists.
       */
      if (
        typeof this.journalRepository
          .withTransaction !==
        'function'
      ) {
        if (
          this.options.strictMode
        ) {
          throw new LedgerEngineError(
            'Atomic transaction support is required for financial ledger persistence.',
            {
              code:
                LEDGER_ERROR_CODES
                  .TRANSACTION_UNAVAILABLE,

              statusCode:
                503,

              tenantId:
                request.tenantId,
            },
          );
        }
      }
    }

    const execute =
      async (
        persistenceContext,
      ) => {
        const journal =
          await this._createJournal(
            postingPlan.journal,
            persistenceContext,
          );

        try {
          await this._createEntries(
            postingPlan.entries,
            journal,
            request,
            persistenceContext,
          );

          const posted =
            await this._markJournalPosted(
              journal,
              request,
              persistenceContext,
            );

          return this._buildPostingResult(
            posted,
            postingPlan.entries,
            {
              replay:
                false,
            },
          );
        } catch (error) {
          await this._markJournalFailedSafe(
            journal,
            error,
            request,
            persistenceContext,
          );

          throw error;
        }
      };

    if (
      request.persistenceContext
    ) {
      return execute(
        request.persistenceContext,
      );
    }

    if (
      this.transactionManager
      &&
      typeof this.transactionManager
        .withTransaction ===
      'function'
    ) {
      return this.transactionManager
        .withTransaction(
          execute,
          {
            tenantId:
              request.tenantId,

            operationType:
              request.operationType,

            idempotencyKey:
              request.idempotencyKey,
          },
        );
    }

    if (
      typeof this.journalRepository
        .withTransaction ===
      'function'
    ) {
      return this.journalRepository
        .withTransaction(
          execute,
        );
    }

    return execute(
      null,
    );
  }

  async _createJournal(
    journal,
    persistenceContext,
  ) {
    if (
      typeof this.journalRepository
        .createPosting ===
      'function'
    ) {
      const created =
        await this.journalRepository
          .createPosting(
            journal,
            persistenceContext,
          );

      if (
        !created
      ) {
        throw new LedgerEngineError(
          'Journal could not be persisted.',
          {
            code:
              LEDGER_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              503,

            tenantId:
              journal.tenantId,

            journalId:
              journal.id,
          },
        );
      }

      return this._normalizeJournal(
        created,
      );
    }

    if (
      typeof this.journalRepository
        .create ===
      'function'
    ) {
      const created =
        await this.journalRepository
          .create(
            journal,
            persistenceContext,
          );

      if (
        !created
      ) {
        throw new LedgerEngineError(
          'Journal could not be persisted.',
          {
            code:
              LEDGER_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              503,

            tenantId:
              journal.tenantId,

            journalId:
              journal.id,
          },
        );
      }

      return this._normalizeJournal(
        created,
      );
    }

    throw new LedgerEngineError(
      'Journal repository does not implement a supported create API.',
      {
        code:
          LEDGER_ERROR_CODES
            .PERSISTENCE_UNAVAILABLE,

        statusCode:
          500,

        tenantId:
          journal.tenantId,

        journalId:
          journal.id,
      },
    );
  }

  async _createEntries(
    entries,
    journal,
    request,
    persistenceContext,
  ) {
    if (
      !this.journalEntryRepository
    ) {
      throw new LedgerEngineError(
        'Journal entry repository is unavailable.',
        {
          code:
            LEDGER_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            503,

          tenantId:
            request.tenantId,

          journalId:
            journal.id,
        },
      );
    }

    const records =
      entries.map(
        (
          entry,
          index,
        ) => ({
          id:
            entry.id ||
            createEntryId(),

          journalId:
            journal.id,

          tenantId:
            request.tenantId,

          accountId:
            entry.accountId,

          entryType:
            entry.entryType,

          type:
            entry.entryType,

          amount:
            entry.amount,

          currency:
            request.currency,

          description:
            entry.description ||
            journal.description ||
            null,

          reference:
            entry.reference ||
            journal.postingReference ||
            null,

          sequence:
            entry.sequence ||
            index + 1,

          accountingDate:
            journal.accountingDate,

          transactionId:
            request.transactionId ||
            null,

          operationType:
            request.operationType,

          metadata:
            this._sanitizeMetadata(
              entry.metadata,
            ),

          createdAt:
            now(),
        }),
      );

    if (
      typeof this.journalEntryRepository
        .createMany ===
      'function'
    ) {
      const result =
        await this.journalEntryRepository
          .createMany(
            records,
            persistenceContext,
          );

      if (
        !Array.isArray(
          result,
        )
      ) {
        throw new LedgerEngineError(
          'Journal entries could not be persisted.',
          {
            code:
              LEDGER_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              503,

            tenantId:
              request.tenantId,

            journalId:
              journal.id,
          },
        );
      }

      return result;
    }

    if (
      typeof this.journalEntryRepository
        .insertMany ===
      'function'
    ) {
      const result =
        await this.journalEntryRepository
          .insertMany(
            records,
            persistenceContext,
          );

      if (
        !Array.isArray(
          result,
        )
      ) {
        throw new LedgerEngineError(
          'Journal entries could not be persisted.',
          {
            code:
              LEDGER_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              503,

            tenantId:
              request.tenantId,

            journalId:
              journal.id,
          },
        );
      }

      return result;
    }

    if (
      typeof this.journalEntryRepository
        .create ===
      'function'
    ) {
      const created = [];

      for (
        const record of
          records
      ) {
        created.push(
          await this.journalEntryRepository
            .create(
              record,
              persistenceContext,
            ),
        );
      }

      return created;
    }

    throw new LedgerEngineError(
      'Journal entry repository does not implement a supported batch-create API.',
      {
        code:
          LEDGER_ERROR_CODES
            .PERSISTENCE_UNAVAILABLE,

        statusCode:
          500,

        tenantId:
          request.tenantId,

        journalId:
          journal.id,
      },
    );
  }

  async _markJournalPosted(
    journal,
    request,
    persistenceContext,
  ) {
    if (
      typeof this.journalRepository
        .markPosted ===
      'function'
    ) {
      const posted =
        await this.journalRepository
          .markPosted(
            journal.id,
            {
              tenantId:
                request.tenantId,

              expectedVersion:
                parseVersion(
                  journal.version,
                ) ??
                0,

              status:
                JOURNAL_STATUS.POSTED,

              postedAt:
                now(),

              updatedAt:
                now(),
            },
            persistenceContext,
          );

      if (
        !posted
      ) {
        throw new LedgerEngineError(
          'Journal could not be marked as POSTED.',
          {
            code:
              LEDGER_ERROR_CODES
                .CONCURRENT_UPDATE,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            journalId:
              journal.id,
          },
        );
      }

      return this._normalizeJournal(
        posted,
      );
    }

    if (
      typeof this.journalRepository
        .updateWithVersion ===
      'function'
    ) {
      const posted =
        await this.journalRepository
          .updateWithVersion(
            journal.id,
            parseVersion(
              journal.version,
            ) ??
              0,
            {
              status:
                JOURNAL_STATUS.POSTED,

              postedAt:
                now(),

              updatedAt:
                now(),

              version:
                (
                  parseVersion(
                    journal.version,
                  ) ??
                  0
                ) + 1,
            },
            {
              tenantId:
                request.tenantId,

              persistenceContext,
            },
          );

      if (
        !posted
      ) {
        throw new LedgerEngineError(
          'Journal could not be marked as POSTED.',
          {
            code:
              LEDGER_ERROR_CODES
                .CONCURRENT_UPDATE,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            journalId:
              journal.id,
          },
        );
      }

      return this._normalizeJournal(
        posted,
      );
    }

    if (
      typeof this.journalRepository
        .update ===
      'function'
    ) {
      if (
        this.options.strictMode
      ) {
        throw new LedgerEngineError(
          'Atomic journal posting update is required in strict mode.',
          {
            code:
              LEDGER_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              500,

            tenantId:
              request.tenantId,

            journalId:
              journal.id,
          },
        );
      }

      const posted =
        await this.journalRepository
          .update(
            journal.id,
            {
              status:
                JOURNAL_STATUS.POSTED,

              postedAt:
                now(),

              updatedAt:
                now(),
            },
            persistenceContext,
          );

      return this._normalizeJournal(
        posted ||
          {
            ...journal,
            status:
              JOURNAL_STATUS.POSTED,
          },
      );
    }

    throw new LedgerEngineError(
      'Journal repository does not implement a supported posting API.',
      {
        code:
          LEDGER_ERROR_CODES
            .PERSISTENCE_UNAVAILABLE,

        statusCode:
          500,

        tenantId:
          request.tenantId,

        journalId:
          journal.id,
      },
    );
  }

  async _markJournalFailedSafe(
    journal,
    error,
    request,
    persistenceContext,
  ) {
    if (
      !journal
      || !this.journalRepository
    ) {
      return;
    }

    const patch = {
      status:
        JOURNAL_STATUS.FAILED,

      failureCode:
        error?.code ||
        'LEDGER_POSTING_FAILED',

      failureMessage:
        String(
          error?.message ||
            'Ledger posting failed.',
        ).slice(
          0,
          1000,
        ),

      updatedAt:
        now(),
    };

    try {
      if (
        typeof this.journalRepository
          .markFailed ===
        'function'
      ) {
        await this.journalRepository
          .markFailed(
            journal.id,
            patch,
            persistenceContext,
          );
      }
    } catch (secondaryError) {
      this._logError(
        'Failed to persist journal failure state.',
        secondaryError,
        {
          journalId:
            journal.id,

          tenantId:
            request.tenantId,
        },
      );
    }
  }

  /* ==========================================================================
   * Idempotency
   * ======================================================================== */

  async _findExistingByIdempotency(
    request,
  ) {
    if (
      !this.journalRepository
    ) {
      return null;
    }

    let existing =
      null;

    if (
      typeof this.journalRepository
        .findByIdempotency ===
      'function'
    ) {
      existing =
        await this.journalRepository
          .findByIdempotency(
            {
              tenantId:
                request.tenantId,

              operationType:
                request.operationType,

              idempotencyKey:
                request.idempotencyKey,
            },
          );
    } else if (
      typeof this.journalRepository
        .findOne ===
      'function'
    ) {
      existing =
        await this.journalRepository
          .findOne(
            {
              tenantId:
                request.tenantId,

              operationType:
                request.operationType,

              idempotencyKey:
                request.idempotencyKey,
            },
          );
    }

    if (
      !existing
    ) {
      return null;
    }

    const journal =
      this._normalizeJournal(
        existing.journal ||
          existing,
      );

    if (
      request.payloadFingerprint
      &&
      journal.payloadFingerprint
      &&
      request.payloadFingerprint !==
        journal.payloadFingerprint
    ) {
      throw new LedgerEngineError(
        'Idempotency key has already been used with a different ledger payload.',
        {
          code:
            LEDGER_ERROR_CODES
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
            journal.id,
        },
      );
    }

    const entries =
      existing.entries
      ||
      await this._loadJournalEntries(
        journal.id,
        request.tenantId,
      );

    return {
      journal,

      entries,
    };
  }

  async _reserveIdempotency(
    request,
    postingPlan,
  ) {
    if (
      !this.idempotencyService
    ) {
      if (
        this.options.requireIdempotency
      ) {
        /**
         * A journal repository uniqueness constraint is not always sufficient
         * to safely expose replay semantics. Strict production configuration
         * therefore expects the shared idempotency service.
         */
        if (
          this.options.strictMode
        ) {
          throw new LedgerEngineError(
            'Ledger idempotency service is required in strict mode.',
            {
              code:
                LEDGER_ERROR_CODES
                  .CONFIGURATION_ERROR,

              statusCode:
                500,

              tenantId:
                request.tenantId,

              operationType:
                request.operationType,

              idempotencyKey:
                request.idempotencyKey,
            },
          );
        }
      }

      return {
        operationId:
          `ledger_${postingPlan.journal.id}`,

        completed:
          false,
      };
    }

    const result =
      await this.idempotencyService
        .reserve({
          tenantId:
            request.tenantId,

          operationType:
            request.operationType,

          key:
            request.idempotencyKey,

          operationId:
            `ledger_op_${postingPlan.journal.id}`,

          request: {
            journalId:
              postingPlan.journal.id,

            operationType:
              request.operationType,

            transactionId:
              request.transactionId,

            currency:
              request.currency,

            accountingDate:
              request.accountingDate,

            totalDebit:
              postingPlan.journal
                .totalDebit,

            totalCredit:
              postingPlan.journal
                .totalCredit,

            entries:
              postingPlan.entries
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
            this._sanitizeMetadata(
              request.metadata,
            ),
        });

    return {
      ...result,

      completed:
        result.completed ===
        true,

      operationId:
        result.operationId,
    };
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

    try {
      return await this.idempotencyService
        .complete(
          operation.operationId,
          result,
          {
            tenantId:
              request.tenantId,
          },
        );
    } catch (error) {
      /**
       * The ledger commit is authoritative.
       *
       * If the database transaction has committed but idempotency persistence
       * fails, log loudly and surface a retryable operational error. A later
       * retry must discover the journal via the unique business identity.
       */
      this._logError(
        'Ledger posting committed but idempotency completion failed.',
        error,
        {
          journalId:
            result.journalId,

          tenantId:
            request.tenantId,

          operationId:
            operation.operationId,
        },
      );

      throw new LedgerEngineError(
        'Ledger posting committed but idempotency finalization failed.',
        {
          code:
            LEDGER_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            503,

          tenantId:
            request.tenantId,

          journalId:
            result.journalId,

          retryable:
            true,

          cause:
            error,
        },
      );
    }
  }

  async _handlePostingFailure(
    request,
    operation,
    error,
  ) {
    if (
      !this.idempotencyService
      || !operation?.operationId
    ) {
      return;
    }

    try {
      if (
        error?.unknownOutcome ===
        true
      ) {
        await this.idempotencyService
          .markUnknown(
            operation.operationId,
            {
              tenantId:
                request.tenantId,

              reasonCode:
                error.code ||
                'LEDGER_POSTING_UNKNOWN',

              reason:
                error.message,
            },
          );
      } else {
        await this.idempotencyService
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
      }
    } catch (idempotencyError) {
      this._logError(
        'Failed to persist ledger idempotency failure state.',
        idempotencyError,
        {
          tenantId:
            request.tenantId,

          operationId:
            operation.operationId,
        },
      );
    }
  }

  /* ==========================================================================
   * Reversal Persistence
   * ======================================================================== */

  async _markJournalReversed(
    originalJournal,
    reversalJournalId,
    request,
  ) {
    if (
      !this.journalRepository
    ) {
      return null;
    }

    const patch = {
      status:
        JOURNAL_STATUS.REVERSED,

      reversalJournalId:

        reversalJournalId,

      reversedAt:
        now(),

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
            originalJournal.id,
            patch,
            {
              tenantId:
                request.tenantId,

              expectedVersion:
                parseVersion(
                  originalJournal.version,
                ) ??
                0,
            },
          );

      if (
        !updated
      ) {
        throw new LedgerEngineError(
          'Original journal could not be marked as REVERSED.',
          {
            code:
              LEDGER_ERROR_CODES
                .CONCURRENT_UPDATE,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            journalId:
              originalJournal.id,

            reversalJournalId,
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
      return this.journalRepository
        .updateWithVersion(
          originalJournal.id,
          parseVersion(
            originalJournal.version,
          ) ??
            0,
          {
            ...patch,

            version:
              (
                parseVersion(
                  originalJournal.version,
                ) ??
                0
              ) + 1,
          },
          {
            tenantId:
              request.tenantId,
          },
        );
    }

    if (
      this.options.strictMode
    ) {
      throw new LedgerEngineError(
        'Atomic journal reversal linkage is required in strict mode.',
        {
          code:
            LEDGER_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            500,

          tenantId:
            request.tenantId,

          journalId:
            originalJournal.id,
        },
      );
    }

    return null;
  }

  _buildReversalEntries(
    entries,
  ) {
    return entries.map(
      (
        entry,
        index,
      ) => ({
        accountId:
          entry.accountId,

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
          canonicalAmount(
            entry.amount,
            this.options,
          ),

        currency:
          normalizeCurrency(
            entry.currency,
          ),

        description:
          `Reversal of journal entry ${entry.id || index + 1}`,

        metadata:
          {
            reversalOfEntryId:
              entry.id ||
              null,
          },
      }),
    );
  }

  /* ==========================================================================
   * Journal Retrieval
   * ======================================================================== */

  async _loadJournalAggregate(
    journalId,
    context,
  ) {
    if (
      !this.journalRepository
    ) {
      throw new LedgerEngineError(
        'Journal repository is unavailable.',
        {
          code:
            LEDGER_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            503,

          tenantId:
            context.tenantId ||
            null,

          journalId,
        },
      );
    }

    let journal =
      null;

    if (
      typeof this.journalRepository
        .findAggregateById ===
      'function'
    ) {
      journal =
        await this.journalRepository
          .findAggregateById(
            journalId,
            {
              tenantId:
                context.tenantId,
            },
          );
    } else if (
      typeof this.journalRepository
        .findById ===
      'function'
    ) {
      journal =
        await this.journalRepository
          .findById(
            journalId,
            {
              tenantId:
                context.tenantId,
            },
          );
    } else if (
      typeof this.journalRepository
        .getById ===
      'function'
    ) {
      journal =
        await this.journalRepository
          .getById(
            journalId,
            {
              tenantId:
                context.tenantId,
            },
          );
    }

    if (
      !journal
    ) {
      throw new LedgerEngineError(
        'Journal was not found.',
        {
          code:
            LEDGER_ERROR_CODES
              .JOURNAL_NOT_FOUND,

          statusCode:
            404,

          tenantId:
            context.tenantId ||
            null,

          journalId,
        },
      );
    }

    const normalizedJournal =
      this._normalizeJournal(
        journal.journal ||
          journal,
      );

    const entries =
      journal.entries ||
      await this._loadJournalEntries(
        normalizedJournal.id,
        context.tenantId,
      );

    return {
      journal:
        normalizedJournal,

      entries:
        entries.map(
          this._normalizePersistedEntry.bind(
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

    return [];
  }

  async _findJournalByTransactionId(
    transactionId,
    tenantId,
  ) {
    if (
      !this.journalRepository
    ) {
      return null;
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
   * Result Construction
   * ======================================================================== */

  _buildPostingResult(
    journal,
    entries,
    options = {},
  ) {
    const normalizedJournal =
      this._normalizeJournal(
        journal,
      );

    const normalizedEntries =
      (
        entries ||
        []
      ).map(
        this._normalizePersistedEntry.bind(
          this,
        ),
      );

    return {
      success:
        normalizedJournal.status ===
        JOURNAL_STATUS.POSTED,

      journalId:
        normalizedJournal.id,

      postingReference:
        normalizedJournal
          .postingReference,

      transactionId:
        normalizedJournal
          .transactionId,

      tenantId:
        normalizedJournal.tenantId,

      operationType:
        normalizedJournal
          .operationType,

      status:
        normalizedJournal.status,

      currency:
        normalizedJournal.currency,

      accountingDate:
        normalizedJournal.accountingDate,

      totalDebit:
        normalizedJournal.totalDebit,

      totalCredit:
        normalizedJournal.totalCredit,

      entryCount:
        normalizedEntries.length,

      entries:
        normalizedEntries.map(
          (
            entry,
          ) => ({
            id:
              entry.id,

            journalId:
              entry.journalId,

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
        normalizedJournal.source,

      sourceId:
        normalizedJournal.sourceId,

      reversalOfJournalId:
        normalizedJournal
          .reversalOfJournalId ||
        null,

      reversalJournalId:
        normalizedJournal
          .reversalJournalId ||
        null,

      replay:
        options.replay ===
        true,

      createdAt:
        normalizedJournal.createdAt,

      postedAt:
        normalizedJournal.postedAt,

      updatedAt:
        normalizedJournal.updatedAt,
    };
  }

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

    const id =
      safeId(
        plain.id ||
        plain._id,
      );

    return {
      ...clone(
        plain,
      ),

      id,

      tenantId:
        normalizeString(
          plain.tenantId,
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

      idempotencyKey:
        normalizeString(
          plain.idempotencyKey,
        ),

      postingReference:
        normalizeString(
          plain.postingReference ||
          plain.reference,
        ),

      externalReference:
        normalizeString(
          plain.externalReference,
        ),

      status:
        normalizeStatus(
          plain.status,
        ) ||
        JOURNAL_STATUS.POSTING,

      currency:
        normalizeCurrency(
          plain.currency,
        ),

      accountingDate:
        plain.accountingDate ||
        null,

      effectiveAt:
        plain.effectiveAt ||
        null,

      description:
        normalizeString(
          plain.description,
        ),

      source:
        normalizeString(
          plain.source,
        ),

      sourceId:
        safeId(
          plain.sourceId,
        ),

      reversalOfJournalId:
        safeId(
          plain.reversalOfJournalId,
        ),

      reversalJournalId:
        safeId(
          plain.reversalJournalId,
        ),

      totalDebit:
        canonicalAmount(
          plain.totalDebit,
          this.options,
        ),

      totalCredit:
        canonicalAmount(
          plain.totalCredit,
          this.options,
        ),

      entryCount:
        Number(
          plain.entryCount ||
            0,
        ),

      version:
        parseVersion(
          plain.version,
        ) ??
        0,

      payloadFingerprint:
        normalizeString(
          plain.payloadFingerprint,
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

  _normalizePersistedEntry(
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

    const id =
      safeId(
        plain.id ||
        plain._id,
      );

    const entryType =
      normalizeStatus(
        plain.entryType ||
        plain.type,
      );

    return {
      ...clone(
        plain,
      ),

      id,

      journalId:
        safeId(
          plain.journalId,
        ),

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      accountId:
        normalizeAccountId(
          plain.accountId,
        ),

      entryType,

      type:
        entryType,

      amount:
        canonicalAmount(
          plain.amount,
          this.options,
        ),

      currency:
        normalizeCurrency(
          plain.currency,
        ),

      description:
        normalizeString(
          plain.description,
        ),

      reference:
        normalizeString(
          plain.reference,
        ),

      sequence:
        Number(
          plain.sequence ||
            0,
        ),

      accountingDate:
        plain.accountingDate ||
        null,

      transactionId:
        safeId(
          plain.transactionId,
        ),
    };
  }

  /* ==========================================================================
   * Request Normalization
   * ======================================================================== */

  _normalizePostingRequest(
    input,
  ) {
    const value =
      input &&
      typeof input ===
        'object'
        ? input
        : {};

    const request = {
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

      journalId:
        safeId(
          value.journalId,
        ),

      transactionId:
        safeId(
          value.transactionId,
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

      metadata:
        this._sanitizeMetadata(
          value.metadata ||
          {},
        ),

      persistenceContext:
        value.persistenceContext ||
        value.session ||
        null,

      entries:
        Array.isArray(
          value.entries,
        )
          ? value.entries
          : [],
    };

    request.payloadFingerprint =
      sha256({
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

        source:
          request.source,

        sourceId:
          request.sourceId,

        reversalOfJournalId:
          request.reversalOfJournalId,

        entries:
          request.entries.map(
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
                  this.options,
                ),

              currency:
                normalizeCurrency(
                  entry.currency ||
                    request.currency,
                ),
            }),
          ),
      });

    return request;
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

      operationType:
        LEDGER_OPERATION_TYPES
          .REVERSAL,

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

      persistenceContext:
        value.persistenceContext ||
        value.session ||
        null,
    };
  }

  /* ==========================================================================
   * Event / Audit
   * ======================================================================== */

  async _publishPostingEvent(
    result,
    request,
  ) {
    if (
      !this.options.publishEvents
      || !this.eventPublisher
    ) {
      return null;
    }

    const event = {
      eventId:
        `evt_ledger_${crypto.randomUUID()}`,

      eventType:
        request.reversalOfJournalId
          ? 'LedgerReversalPosted'
          : 'LedgerJournalPosted',

      eventVersion:
        1,

      occurredAt:
        isoNow(),

      tenantId:
        request.tenantId,

      aggregateType:
        'Journal',

      aggregateId:
        result.journalId,

      correlationId:
        request.correlationId ||
        null,

      causationId:
        request.causationId ||
        null,

      operationId:
        request.idempotencyKey,

      data: {
        journalId:
          result.journalId,

        postingReference:
          result.postingReference,

        transactionId:
          result.transactionId,

        operationType:
          result.operationType,

        status:
          result.status,

        currency:
          result.currency,

        totalDebit:
          result.totalDebit,

        totalCredit:
          result.totalCredit,

        entryCount:
          result.entryCount,

        reversalOfJournalId:
          result.reversalOfJournalId,
      },

      metadata:
        this._sanitizeMetadata(
          request.metadata,
        ),
    };

    event.eventFingerprint =
      sha256(
        {
          eventType:
            event.eventType,

          tenantId:
            event.tenantId,

          journalId:
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
          event.eventType,
          event,
        );
      }
    } catch (error) {
      this._logError(
        'Ledger event publication failed.',
        error,
        {
          journalId:
            result.journalId,

          tenantId:
            request.tenantId,
        },
      );

      if (
        this.options
          .failOnEventPublicationError
      ) {
        throw new LedgerEngineError(
          'Ledger event publication failed.',
          {
            code:
              LEDGER_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              503,

            tenantId:
              request.tenantId,

            journalId:
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
        'LedgerJournal',

      resourceId:
        data.journalId ||
        null,

      tenantId:
        data.tenantId ||
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
        'Ledger audit persistence failed.',
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
   * Diagnostics
   * ======================================================================== */

  getStatuses() {
    return Object.freeze({
      ...JOURNAL_STATUS,
    });
  }

  getEntryTypes() {
    return Object.freeze({
      ...ENTRY_TYPE,
    });
  }

  getOperationTypes() {
    return Object.freeze({
      ...LEDGER_OPERATION_TYPES,
    });
  }

  getErrorCodes() {
    return Object.freeze({
      ...LEDGER_ERROR_CODES,
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

      maxEntries:
        this.options.maxEntries,

      maxDecimalPlaces:
        this.options
          .maxDecimalPlaces,

      requireAtomicPersistence:
        this.options
          .requireAtomicPersistence,

      immutableHistory:
        this.options
          .immutableHistory,

      validateAccounts:
        this.options
          .validateAccounts,

      requireBalancedDoubleEntry:
        this.options
          .requireBalancedDoubleEntry,

      allowMultipleLinesPerAccount:
        this.options
          .allowMultipleLinesPerAccount,

      enforceSingleJournalCurrency:
        this.options
          .enforceSingleJournalCurrency,

      reversalCreatesCompensatingJournal:
        this.options
          .reversalCreatesCompensatingJournal,

      publishEvents:
        this.options
          .publishEvents,

      hasJournalRepository:
        Boolean(
          this.journalRepository,
        ),

      hasJournalEntryRepository:
        Boolean(
          this.journalEntryRepository,
        ),

      hasAccountRepository:
        Boolean(
          this.accountRepository,
        ),

      hasAccountService:
        Boolean(
          this.accountService,
        ),

      hasTransactionManager:
        Boolean(
          this.transactionManager,
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
      && !this.journalRepository
    ) {
      errors.push(
        'journalRepository is required in strict mode.',
      );
    }

    if (
      this.options.strictMode
      && !this.journalEntryRepository
    ) {
      errors.push(
        'journalEntryRepository is required in strict mode.',
      );
    }

    if (
      this.options.validateAccounts
      && this.options.strictMode
      && !this.accountRepository
      && !this.accountService
    ) {
      errors.push(
        'accountRepository or accountService is required for account validation.',
      );
    }

    if (
      this.options.requireIdempotency
      && this.options.strictMode
      && !this.idempotencyService
    ) {
      errors.push(
        'idempotencyService is required in strict mode.',
      );
    }

    if (
      this.options.requireAtomicPersistence
      && this.options.strictMode
      && !this.transactionManager
      && !this.journalRepository?.withTransaction
    ) {
      errors.push(
        'transactionManager or journalRepository.withTransaction is required for atomic financial persistence.',
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
   * Generic Helpers
   * ======================================================================== */

  _sanitizeMetadata(
    metadata,
    depth = 0,
  ) {
    if (
      !metadata
      || typeof metadata !==
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
          Array.isArray(value)
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

  _wrapPersistenceError(
    error,
    request,
  ) {
    if (
      error instanceof
      LedgerEngineError
    ) {
      return error;
    }

    return new LedgerEngineError(
      error?.message ||
        'Ledger persistence failed.',
      {
        code:
          LEDGER_ERROR_CODES
            .PERSISTENCE_UNAVAILABLE,

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

        retryable:
          true,

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
      /**
       * Metrics are observational only.
       */
    }
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

LedgerEngine.STATUS =
  JOURNAL_STATUS;

LedgerEngine.JOURNAL_STATUS =
  JOURNAL_STATUS;

LedgerEngine.ENTRY_TYPE =
  ENTRY_TYPE;

LedgerEngine.ACCOUNT_STATUS =
  ACCOUNT_STATUS;

LedgerEngine.OPERATION_TYPES =
  LEDGER_OPERATION_TYPES;

LedgerEngine.ERROR_CODES =
  LEDGER_ERROR_CODES;

LedgerEngine.LedgerEngineError =
  LedgerEngineError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createLedgerEngine(
  dependencies = {},
) {
  return new LedgerEngine(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  LedgerEngine;

module.exports.LedgerEngine =
  LedgerEngine;

module.exports.LedgerEngineError =
  LedgerEngineError;

module.exports.createLedgerEngine =
  createLedgerEngine;

module.exports.JOURNAL_STATUS =
  JOURNAL_STATUS;

module.exports.ENTRY_TYPE =
  ENTRY_TYPE;

module.exports.ACCOUNT_STATUS =
  ACCOUNT_STATUS;

module.exports.LEDGER_OPERATION_TYPES =
  LEDGER_OPERATION_TYPES;

module.exports.LEDGER_ERROR_CODES =
  LEDGER_ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */