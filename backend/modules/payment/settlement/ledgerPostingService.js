/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/ledgerPostingService.js
 *
 * Architectural Role:
 *   Canonical application service for converting financially approved payment
 *   events into balanced double-entry ledger postings.
 *
 * Purpose:
 *   Provide a controlled, idempotent, tenant-aware accounting boundary between
 *   payment/financial transaction workflows and the canonical ledger.
 *
 * Responsibilities:
 *   - Validate posting input and accounting invariants.
 *   - Enforce tenant-scoped ledger posting.
 *   - Create balanced double-entry journal entries through the canonical ledger
 *     repository/model boundary.
 *   - Enforce durable idempotency for accounting postings.
 *   - Support MongoDB transaction/session propagation.
 *   - Prevent duplicate journal posting.
 *   - Support reversal requests without mutating historical ledger entries.
 *   - Provide posting-status lookup and reconciliation helpers.
 *
 * Non-Responsibilities:
 *   - This service does NOT initiate external payments.
 *   - This service does NOT verify MTN/Airtel/bank signatures.
 *   - This service does NOT authorize users or tenants.
 *   - This service does NOT mutate Wallet.balance directly.
 *   - This service does NOT mutate Account balances through ad-hoc arithmetic.
 *   - This service does NOT perform provider settlement orchestration.
 *   - This service does NOT replace FinancialTransactionService.
 *   - This service does NOT silently repair accounting discrepancies.
 *
 * Financial Architecture:
 *
 *   Payment / PaymentIntent
 *           |
 *           v
 *   FinancialTransactionService
 *           |
 *           +-------------------------+
 *           |                         |
 *           v                         v
 *      Wallet / Account          LedgerPostingService
 *                                     |
 *                                     v
 *                              LedgerRepository
 *                                     |
 *                                     v
 *                            Double-entry Ledger
 *
 * Accounting Boundary:
 *   The ledger is the accounting source of record.
 *
 *   A payment being COMPLETED does not automatically mean it has been posted
 *   to the ledger. Posting must be an explicit accounting action.
 *
 * Idempotency:
 *   Every posting requires a durable unique posting key.
 *
 *   The posting key must come from the canonical financial transaction/event
 *   identity and MUST be persisted by the ledger layer or an equivalent durable
 *   accounting-posting record.
 *
 *   An in-memory Map/Set is never sufficient for accounting idempotency.
 *
 * Money:
 *   Monetary values are represented using Decimal128-compatible strings or
 *   Decimal128 instances. JavaScript floating-point arithmetic is prohibited.
 *
 * Double-Entry Invariant:
 *   Sum(debits) === Sum(credits)
 *
 *   The service therefore rejects unbalanced journal requests before delegation.
 *
 * Reversal:
 *   Ledger entries are append-oriented.
 *
 *   A reversal creates a new compensating journal entry referencing the original
 *   posting. Historical journal entries are never edited to make them "correct."
 *
 * Security Principles:
 *   - Tenant isolation is mandatory.
 *   - Caller authorization belongs to the service/controller boundary.
 *   - Accounting identity is immutable.
 *   - External provider references are never trusted as ledger account IDs.
 *   - Raw payment-provider payloads are not persisted by this service.
 *   - Error messages do not expose secrets or credentials.
 *   - Generic ledger mutations are not performed here.
 *
 * Module Format:
 *   Native ECMAScript Modules (ESM).
 *
 * =============================================================================
 */

import mongoose from 'mongoose';

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

export const LEDGER_POSTING_STATUS = Object.freeze({
  PENDING: 'PENDING',
  POSTED: 'POSTED',
  ALREADY_POSTED: 'ALREADY_POSTED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
});

export const LEDGER_ENTRY_DIRECTION = Object.freeze({
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
});

export const LEDGER_POSTING_TYPES = Object.freeze({
  PAYMENT: 'PAYMENT',
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  TRANSFER: 'TRANSFER',
  FEE: 'FEE',
  REFUND: 'REFUND',
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
  SETTLEMENT: 'SETTLEMENT',
});

export const DEFAULT_CURRENCY = 'UGX';

export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_REFERENCE_LENGTH = 200;
export const MAX_LINES_PER_POSTING = 100;
export const MAX_METADATA_KEYS = 50;
export const MAX_METADATA_STRING_LENGTH = 2048;

/**
 * =============================================================================
 * ERROR TYPES
 * =============================================================================
 */

export class LedgerPostingError extends Error {
  constructor(
    message,
    code = 'LEDGER_POSTING_ERROR',
    details = null,
  ) {
    super(message);
    this.name = 'LedgerPostingError';
    this.code = code;
    this.details = details;
  }
}

export class LedgerPostingValidationError extends LedgerPostingError {
  constructor(message, details = null) {
    super(
      message,
      'LEDGER_POSTING_VALIDATION_ERROR',
      details,
    );

    this.name = 'LedgerPostingValidationError';
  }
}

export class LedgerPostingIdempotencyError extends LedgerPostingError {
  constructor(message, details = null) {
    super(
      message,
      'LEDGER_POSTING_IDEMPOTENCY_ERROR',
      details,
    );

    this.name = 'LedgerPostingIdempotencyError';
  }
}

export class LedgerPostingBalanceError extends LedgerPostingError {
  constructor(message, details = null) {
    super(
      message,
      'LEDGER_POSTING_UNBALANCED',
      details,
    );

    this.name = 'LedgerPostingBalanceError';
  }
}

export class LedgerPostingConflictError extends LedgerPostingError {
  constructor(message, details = null) {
    super(
      message,
      'LEDGER_POSTING_CONFLICT',
      details,
    );

    this.name = 'LedgerPostingConflictError';
  }
}

/**
 * =============================================================================
 * MONEY HELPERS
 * =============================================================================
 */

/**
 * Accept only Decimal128-compatible non-negative monetary values.
 *
 * @param {string|number|mongoose.Types.Decimal128} value
 * @returns {string}
 */
function normalizeMoney(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    throw new LedgerPostingValidationError(
      'Monetary amount is required',
    );
  }

  if (
    value instanceof mongoose.Types.Decimal128
  ) {
    const result = value.toString();

    if (result.startsWith('-')) {
      throw new LedgerPostingValidationError(
        'Monetary amount cannot be negative',
      );
    }

    return result;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new LedgerPostingValidationError(
        'Monetary amount must be finite',
      );
    }

    if (
      !Number.isSafeInteger(value) &&
      Math.abs(value) >= Number.MAX_SAFE_INTEGER
    ) {
      throw new LedgerPostingValidationError(
        'High-precision monetary values must be supplied as strings or Decimal128',
      );
    }

    if (value < 0) {
      throw new LedgerPostingValidationError(
        'Monetary amount cannot be negative',
      );
    }

    return String(value);
  }

  if (typeof value !== 'string') {
    throw new LedgerPostingValidationError(
      'Monetary amount must be a string, number, or Decimal128',
    );
  }

  const normalized = value.trim();

  if (!/^\d+(?:\.\d{1,18})?$/.test(normalized)) {
    throw new LedgerPostingValidationError(
      'Invalid monetary amount',
    );
  }

  return normalized;
}

function toDecimal128(value) {
  return mongoose.Types.Decimal128.fromString(
    normalizeMoney(value),
  );
}

/**
 * Exact decimal comparison without JavaScript Number arithmetic.
 *
 * The helper compares Decimal128 values by normalized coefficient and scale.
 *
 * @param {string|mongoose.Types.Decimal128} left
 * @param {string|mongoose.Types.Decimal128} right
 * @returns {-1|0|1}
 */
function compareDecimal(left, right) {
  const parse = (value) => {
    const stringValue = normalizeMoney(value);
    const [integerPart, fractionPart = ''] =
      stringValue.split('.');

    const digits =
      `${integerPart}${fractionPart}`.replace(
        /^0+(?=\d)/,
        '',
      ) || '0';

    return {
      digits,
      scale: fractionPart.length,
    };
  };

  const a = parse(left);
  const b = parse(right);

  const commonScale = Math.max(
    a.scale,
    b.scale,
  );

  const coefficientA =
    BigInt(a.digits) *
    10n **
      BigInt(commonScale - a.scale);

  const coefficientB =
    BigInt(b.digits) *
    10n **
      BigInt(commonScale - b.scale);

  if (coefficientA < coefficientB) {
    return -1;
  }

  if (coefficientA > coefficientB) {
    return 1;
  }

  return 0;
}

function isZeroDecimal(value) {
  return compareDecimal(value, '0') === 0;
}

/**
 * Add decimal values exactly.
 *
 * @param {Array<string|mongoose.Types.Decimal128>} values
 * @returns {mongoose.Types.Decimal128}
 */
function addDecimals(values) {
  let scale = 0;
  let coefficient = 0n;

  for (const value of values) {
    const normalized = normalizeMoney(value);

    const [integerPart, fractionPart = ''] =
      normalized.split('.');

    scale = Math.max(
      scale,
      fractionPart.length,
    );
  }

  for (const value of values) {
    const normalized = normalizeMoney(value);

    const [integerPart, fractionPart = ''] =
      normalized.split('.');

    const digits =
      `${integerPart}${fractionPart}` || '0';

    const valueCoefficient =
      BigInt(digits) *
      10n **
        BigInt(scale - fractionPart.length);

    coefficient += valueCoefficient;
  }

  const sign = coefficient < 0n ? '-' : '';
  const absolute = coefficient < 0n
    ? -coefficient
    : coefficient;

  if (scale === 0) {
    return mongoose.Types.Decimal128.fromString(
      `${sign}${absolute.toString()}`,
    );
  }

  const raw = absolute
    .toString()
    .padStart(scale + 1, '0');

  const integerPart = raw.slice(0, -scale);
  const fractionPart = raw.slice(-scale);

  return mongoose.Types.Decimal128.fromString(
    `${sign}${integerPart}.${fractionPart}`,
  );
}

/**
 * =============================================================================
 * VALIDATION HELPERS
 * =============================================================================
 */

function normalizeRequiredString(
  value,
  field,
  {
    maxLength = MAX_REFERENCE_LENGTH,
  } = {},
) {
  if (
    value === null ||
    value === undefined
  ) {
    throw new LedgerPostingValidationError(
      `${field} is required`,
    );
  }

  const normalized = String(value).trim();

  if (!normalized) {
    throw new LedgerPostingValidationError(
      `${field} is required`,
    );
  }

  if (normalized.length > maxLength) {
    throw new LedgerPostingValidationError(
      `${field} exceeds ${maxLength} characters`,
    );
  }

  return normalized;
}

function normalizeOptionalString(
  value,
  field,
  maxLength = MAX_REFERENCE_LENGTH,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized = String(value).trim();

  if (normalized.length > maxLength) {
    throw new LedgerPostingValidationError(
      `${field} exceeds ${maxLength} characters`,
    );
  }

  return normalized || null;
}

/**
 * Validate account identifiers without assuming whether the repository uses
 * MongoDB ObjectIds or application-level accounting codes.
 */
function normalizeAccountId(value, field) {
  return normalizeRequiredString(
    value,
    field,
    {
      maxLength: 256,
    },
  );
}

function validateMetadata(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new LedgerPostingValidationError(
      'metadata must be a plain object',
    );
  }

  const keys = Object.keys(value);

  if (keys.length > MAX_METADATA_KEYS) {
    throw new LedgerPostingValidationError(
      `metadata cannot contain more than ${MAX_METADATA_KEYS} keys`,
    );
  }

  for (const key of keys) {
    if (
      key.startsWith('$') ||
      key.includes('.')
    ) {
      throw new LedgerPostingValidationError(
        `metadata contains unsafe key: ${key}`,
      );
    }

    if (
      typeof value[key] === 'string' &&
      value[key].length >
        MAX_METADATA_STRING_LENGTH
    ) {
      throw new LedgerPostingValidationError(
        `metadata.${key} exceeds ${MAX_METADATA_STRING_LENGTH} characters`,
      );
    }
  }

  return value;
}

/**
 * =============================================================================
 * SERVICE
 * =============================================================================
 */

class LedgerPostingService {
  /**
   * @param {Object} dependencies
   * @param {Object} dependencies.ledgerRepository
   * @param {Object} [dependencies.auditService]
   * @param {Object} [dependencies.logger]
   */
  constructor({
    ledgerRepository,
    auditService = null,
    logger = null,
  } = {}) {
    this.ledgerRepository =
      ledgerRepository;

    this.auditService =
      auditService;

    this.logger =
      logger;

    this.assertDependencies();
  }

  /**
   * ===========================================================================
   * DEPENDENCY VALIDATION
   * ===========================================================================
   */

  assertDependencies() {
    if (
      !this.ledgerRepository ||
      typeof this.ledgerRepository !==
        'object'
    ) {
      throw new LedgerPostingError(
        'ledgerRepository is required',
        'LEDGER_REPOSITORY_REQUIRED',
      );
    }

    /**
     * The repository contract is intentionally small.
     *
     * A repository implementation may internally use Ledger, JournalEntry,
     * LedgerEntry, or another canonical accounting aggregate.
     */
    if (
      typeof this.ledgerRepository.findPostingByIdempotencyKey !==
      'function'
    ) {
      throw new LedgerPostingError(
        'ledgerRepository.findPostingByIdempotencyKey() is required',
        'LEDGER_REPOSITORY_CONTRACT_INVALID',
      );
    }

    if (
      typeof this.ledgerRepository.createPosting !==
      'function'
    ) {
      throw new LedgerPostingError(
        'ledgerRepository.createPosting() is required',
        'LEDGER_REPOSITORY_CONTRACT_INVALID',
      );
    }
  }

  /**
   * ===========================================================================
   * INPUT NORMALIZATION
   * ===========================================================================
   */

  normalizePostingInput(input = {}) {
    const tenantId =
      normalizeRequiredString(
        input.tenantId,
        'tenantId',
        {
          maxLength: 128,
        },
      );

    const postingKey =
      normalizeRequiredString(
        input.postingKey ||
          input.idempotencyKey,
        'postingKey',
        {
          maxLength: 256,
        },
      );

    const transactionId =
      normalizeOptionalString(
        input.transactionId,
        'transactionId',
        256,
      );

    const paymentId =
      normalizeOptionalString(
        input.paymentId,
        'paymentId',
        256,
      );

    const provider =
      normalizeOptionalString(
        input.provider,
        'provider',
        100,
      );

    const providerReference =
      normalizeOptionalString(
        input.providerReference,
        'providerReference',
        MAX_REFERENCE_LENGTH,
      );

    const postingType =
      normalizeRequiredString(
        input.postingType ||
          LEDGER_POSTING_TYPES.PAYMENT,
        'postingType',
        {
          maxLength: 50,
        },
      ).toUpperCase();

    if (
      !Object.values(
        LEDGER_POSTING_TYPES,
      ).includes(postingType)
    ) {
      throw new LedgerPostingValidationError(
        `Unsupported ledger posting type: ${postingType}`,
      );
    }

    const currency =
      normalizeRequiredString(
        input.currency ||
          DEFAULT_CURRENCY,
        'currency',
        {
          maxLength: 3,
        },
      ).toUpperCase();

    if (
      !/^[A-Z]{3}$/.test(currency)
    ) {
      throw new LedgerPostingValidationError(
        'currency must be a three-letter ISO 4217 code',
      );
    }

    const description =
      normalizeRequiredString(
        input.description,
        'description',
        {
          maxLength:
            MAX_DESCRIPTION_LENGTH,
        },
      );

    const lines =
      this.normalizeLines(
        input.lines,
        currency,
      );

    const metadata =
      validateMetadata(
        input.metadata,
      );

    return {
      tenantId,
      postingKey,
      transactionId,
      paymentId,
      provider,
      providerReference,
      postingType,
      currency,
      description,
      lines,
      metadata,
      requestedBy:
        input.requestedBy ?? null,
      source:
        normalizeOptionalString(
          input.source,
          'source',
          100,
        ),
      occurredAt:
        input.occurredAt
          ? new Date(input.occurredAt)
          : new Date(),
      correlationId:
        normalizeOptionalString(
          input.correlationId,
          'correlationId',
          256,
        ),
    };
  }

  normalizeLines(lines, currency) {
    if (!Array.isArray(lines)) {
      throw new LedgerPostingValidationError(
        'posting lines must be an array',
      );
    }

    if (
      lines.length < 2
    ) {
      throw new LedgerPostingValidationError(
        'A double-entry posting requires at least two lines',
      );
    }

    if (
      lines.length >
      MAX_LINES_PER_POSTING
    ) {
      throw new LedgerPostingValidationError(
        `A posting cannot contain more than ${MAX_LINES_PER_POSTING} lines`,
      );
    }

    const normalized =
      lines.map((line, index) => {
        if (
          !line ||
          typeof line !== 'object'
        ) {
          throw new LedgerPostingValidationError(
            `Invalid posting line at index ${index}`,
          );
        }

        const accountId =
          normalizeAccountId(
            line.accountId ||
              line.accountCode,
            `lines[${index}].accountId`,
          );

        const direction =
          normalizeRequiredString(
            line.direction,
            `lines[${index}].direction`,
            {
              maxLength: 10,
            },
          ).toUpperCase();

        if (
          !Object.values(
            LEDGER_ENTRY_DIRECTION,
          ).includes(direction)
        ) {
          throw new LedgerPostingValidationError(
            `Invalid posting direction at line ${index}`,
          );
        }

        const amount =
          toDecimal128(
            line.amount,
          );

        if (
          isZeroDecimal(amount)
        ) {
          throw new LedgerPostingValidationError(
            `Posting line ${index} amount must be greater than zero`,
          );
        }

        const lineCurrency =
          normalizeRequiredString(
            line.currency ||
              currency,
            `lines[${index}].currency`,
            {
              maxLength: 3,
            },
          ).toUpperCase();

        if (
          lineCurrency !== currency
        ) {
          throw new LedgerPostingValidationError(
            `Posting line ${index} currency ${lineCurrency} does not match posting currency ${currency}`,
          );
        }

        return {
          accountId,
          direction,
          amount,
          currency: lineCurrency,

          reference:
            normalizeOptionalString(
              line.reference,
              `lines[${index}].reference`,
              MAX_REFERENCE_LENGTH,
            ),

          description:
            normalizeOptionalString(
              line.description,
              `lines[${index}].description`,
              MAX_DESCRIPTION_LENGTH,
            ),

          metadata:
            validateMetadata(
              line.metadata,
            ),
        };
      });

    this.assertBalanced(
      normalized,
      currency,
    );

    return normalized;
  }

  /**
   * ===========================================================================
   * DOUBLE-ENTRY VALIDATION
   * ===========================================================================
   */

  assertBalanced(
    lines,
    currency,
  ) {
    const debits = lines
      .filter(
        (line) =>
          line.direction ===
          LEDGER_ENTRY_DIRECTION.DEBIT,
      )
      .map(
        (line) => line.amount,
      );

    const credits = lines
      .filter(
        (line) =>
          line.direction ===
          LEDGER_ENTRY_DIRECTION.CREDIT,
      )
      .map(
        (line) => line.amount,
      );

    if (
      debits.length === 0 ||
      credits.length === 0
    ) {
      throw new LedgerPostingBalanceError(
        'A ledger posting requires at least one debit and one credit',
      );
    }

    const debitTotal =
      addDecimals(debits);

    const creditTotal =
      addDecimals(credits);

    if (
      compareDecimal(
        debitTotal,
        creditTotal,
      ) !== 0
    ) {
      throw new LedgerPostingBalanceError(
        `Unbalanced ledger posting: debits=${debitTotal.toString()}, credits=${creditTotal.toString()}, currency=${currency}`,
        {
          debitTotal:
            debitTotal.toString(),
          creditTotal:
            creditTotal.toString(),
          currency,
        },
      );
    }

    return true;
  }

  /**
   * ===========================================================================
   * IDEMPOTENT POSTING
   * ===========================================================================
   */

  /**
   * Post an accounting journal idempotently.
   *
   * The repository MUST enforce uniqueness on the tenant-scoped posting key.
   *
   * @param {Object} input
   * @param {mongoose.ClientSession|null} [session]
   * @returns {Promise<Object>}
   */
  async post(
    input,
    {
      session = null,
      allowAlreadyPosted = true,
    } = {},
  ) {
    const normalized =
      this.normalizePostingInput(
        input,
      );

    /**
     * First read prevents unnecessary duplicate creation attempts.
     *
     * The repository's unique index remains the authoritative race-condition
     * protection.
     */
    const existing =
      await this.ledgerRepository.findPostingByIdempotencyKey(
        {
          tenantId:
            normalized.tenantId,
          postingKey:
            normalized.postingKey,
          session,
        },
      );

    if (existing) {
      this.assertExistingPostingCompatible(
        existing,
        normalized,
      );

      if (!allowAlreadyPosted) {
        throw new LedgerPostingIdempotencyError(
          'Ledger posting already exists',
          {
            postingKey:
              normalized.postingKey,
          },
        );
      }

      return {
        status:
          LEDGER_POSTING_STATUS.ALREADY_POSTED,
        duplicate: true,
        posting:
          existing,
      };
    }

    const payload =
      this.buildRepositoryPayload(
        normalized,
      );

    try {
      const posting =
        await this.ledgerRepository.createPosting(
          payload,
          {
            session,
          },
        );

      await this.auditPosting(
        'LEDGER_POSTED',
        normalized,
        posting,
      );

      return {
        status:
          LEDGER_POSTING_STATUS.POSTED,
        duplicate: false,
        posting,
      };
    } catch (error) {
      /**
       * A concurrent worker may have won the unique-key race.
       *
       * Re-read before surfacing a conflict.
       */
      const concurrent =
        await this.ledgerRepository.findPostingByIdempotencyKey(
          {
            tenantId:
              normalized.tenantId,
            postingKey:
              normalized.postingKey,
            session,
          },
        );

      if (concurrent) {
        this.assertExistingPostingCompatible(
          concurrent,
          normalized,
        );

        return {
          status:
            LEDGER_POSTING_STATUS.ALREADY_POSTED,
          duplicate: true,
          posting:
            concurrent,
        };
      }

      this.logger?.error?.(
        {
          err: error,
          tenantId:
            normalized.tenantId,
          postingKey:
            normalized.postingKey,
          transactionId:
            normalized.transactionId,
        },
        'Ledger posting failed',
      );

      throw new LedgerPostingError(
        error.message ||
          'Ledger posting failed',
        'LEDGER_POSTING_FAILED',
      );
    }
  }

  /**
   * ===========================================================================
   * IDEMPOTENCY CONFLICT PROTECTION
   * ===========================================================================
   */

  assertExistingPostingCompatible(
    existing,
    requested,
  ) {
    if (
      existing.tenantId &&
      String(existing.tenantId) !==
        requested.tenantId
    ) {
      throw new LedgerPostingConflictError(
        'Existing ledger posting belongs to a different tenant',
      );
    }

    if (
      existing.postingKey &&
      String(existing.postingKey) !==
        requested.postingKey
    ) {
      throw new LedgerPostingConflictError(
        'Existing ledger posting has a different posting key',
      );
    }

    /**
     * A reused idempotency key must refer to the same accounting event.
     */
    if (
      requested.transactionId &&
      existing.transactionId &&
      String(
        existing.transactionId,
      ) !== requested.transactionId
    ) {
      throw new LedgerPostingConflictError(
        'Idempotency key is already associated with a different transaction',
      );
    }

    if (
      requested.currency &&
      existing.currency &&
      String(
        existing.currency,
      ).toUpperCase() !==
        requested.currency
    ) {
      throw new LedgerPostingConflictError(
        'Idempotency key is already associated with a different currency',
      );
    }

    return true;
  }

  /**
   * ===========================================================================
   * REPOSITORY PAYLOAD
   * ===========================================================================
   */

  buildRepositoryPayload(
    normalized,
  ) {
    return {
      tenantId:
        normalized.tenantId,

      postingKey:
        normalized.postingKey,

      transactionId:
        normalized.transactionId,

      paymentId:
        normalized.paymentId,

      provider:
        normalized.provider,

      providerReference:
        normalized.providerReference,

      postingType:
        normalized.postingType,

      currency:
        normalized.currency,

      description:
        normalized.description,

      lines:
        normalized.lines.map(
          (line) => ({
            ...line,

            /**
             * Preserve exact monetary representation.
             */
            amount:
              toDecimal128(
                line.amount,
              ),
          }),
        ),

      metadata:
        normalized.metadata,

      requestedBy:
        normalized.requestedBy,

      source:
        normalized.source,

      occurredAt:
        normalized.occurredAt,

      correlationId:
        normalized.correlationId,

      status:
        LEDGER_POSTING_STATUS.POSTED,
    };
  }

  /**
   * ===========================================================================
   * POSTING LOOKUP
   * ===========================================================================
   */

  async getPosting({
    tenantId,
    postingKey,
    session = null,
  } = {}) {
    const normalizedTenantId =
      normalizeRequiredString(
        tenantId,
        'tenantId',
        {
          maxLength: 128,
        },
      );

    const normalizedPostingKey =
      normalizeRequiredString(
        postingKey,
        'postingKey',
        {
          maxLength: 256,
        },
      );

    return this.ledgerRepository
      .findPostingByIdempotencyKey({
        tenantId:
          normalizedTenantId,
        postingKey:
          normalizedPostingKey,
        session,
      });
  }

  /**
   * ===========================================================================
   * REVERSAL
   * ===========================================================================
   */

  /**
   * Create a compensating ledger posting for an existing posting.
   *
   * The original posting is never edited.
   *
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async reverse(
    {
      tenantId,
      originalPosting,
      reversalPostingKey,
      reason,
      requestedBy = null,
      session = null,
    } = {},
  ) {
    if (!originalPosting) {
      throw new LedgerPostingValidationError(
        'originalPosting is required',
      );
    }

    const normalizedTenantId =
      normalizeRequiredString(
        tenantId,
        'tenantId',
        {
          maxLength: 128,
        },
      );

    const normalizedReversalKey =
      normalizeRequiredString(
        reversalPostingKey,
        'reversalPostingKey',
        {
          maxLength: 256,
        },
      );

    const normalizedReason =
      normalizeRequiredString(
        reason,
        'reason',
        {
          maxLength:
            MAX_DESCRIPTION_LENGTH,
        },
      );

    if (
      originalPosting.tenantId &&
      String(
        originalPosting.tenantId,
      ) !== normalizedTenantId
    ) {
      throw new LedgerPostingConflictError(
        'Original posting does not belong to the supplied tenant',
      );
    }

    if (
      originalPosting.status ===
      LEDGER_POSTING_STATUS.REVERSED
    ) {
      throw new LedgerPostingConflictError(
        'Ledger posting has already been reversed',
      );
    }

    const originalLines =
      Array.isArray(
        originalPosting.lines,
      )
        ? originalPosting.lines
        : [];

    if (
      originalLines.length < 2
    ) {
      throw new LedgerPostingValidationError(
        'Original posting does not contain sufficient journal lines for reversal',
      );
    }

    const reversalLines =
      originalLines.map(
        (line) => ({
          accountId:
            line.accountId ||
            line.accountCode,

          direction:
            line.direction ===
            LEDGER_ENTRY_DIRECTION.DEBIT
              ? LEDGER_ENTRY_DIRECTION.CREDIT
              : LEDGER_ENTRY_DIRECTION.DEBIT,

          amount:
            toDecimal128(
              line.amount,
            ),

          currency:
            line.currency ||
            originalPosting.currency,

          reference:
            normalizedReversalKey,

          description:
            `Reversal: ${normalizedReason}`,

          metadata: {
            reversalOf:
              originalPosting.id ||
              originalPosting._id?.toString() ||
              null,
          },
        }),
      );

    return this.post(
      {
        tenantId:
          normalizedTenantId,

        postingKey:
          normalizedReversalKey,

        transactionId:
          originalPosting.transactionId
            ? String(
                originalPosting.transactionId,
              )
            : null,

        paymentId:
          originalPosting.paymentId
            ? String(
                originalPosting.paymentId,
              )
            : null,

        provider:
          originalPosting.provider ||
          null,

        providerReference:
          originalPosting.providerReference ||
          null,

        postingType:
          LEDGER_POSTING_TYPES.REVERSAL,

        currency:
          originalPosting.currency ||
          DEFAULT_CURRENCY,

        description:
          `Reversal of ledger posting: ${normalizedReason}`,

        lines:
          reversalLines,

        metadata: {
          reversalOf:
            originalPosting.id ||
            originalPosting._id?.toString() ||
            null,

          reversalReason:
            normalizedReason,
        },

        requestedBy,
        source:
          'ledger-posting-service',
        correlationId:
          originalPosting.correlationId ||
          null,
      },
      {
        session,
      },
    );
  }

  /**
   * ===========================================================================
   * ACCOUNTING CONVENIENCE BUILDERS
   * ===========================================================================
   *
   * These builders only construct posting instructions.
   *
   * They do not post anything and do not know the actual account ownership
   * rules. Account selection must come from the financial/accounting service.
   */

  buildTwoLinePosting({
    tenantId,
    postingKey,
    transactionId = null,
    paymentId = null,
    provider = null,
    providerReference = null,
    postingType =
      LEDGER_POSTING_TYPES.PAYMENT,
    currency = DEFAULT_CURRENCY,
    description,
    debitAccountId,
    creditAccountId,
    amount,
    requestedBy = null,
    metadata = null,
    source = null,
    correlationId = null,
    occurredAt = null,
  } = {}) {
    return {
      tenantId,
      postingKey,
      transactionId,
      paymentId,
      provider,
      providerReference,
      postingType,
      currency,
      description,

      lines: [
        {
          accountId:
            debitAccountId,
          direction:
            LEDGER_ENTRY_DIRECTION.DEBIT,
          amount,
          currency,
        },

        {
          accountId:
            creditAccountId,
          direction:
            LEDGER_ENTRY_DIRECTION.CREDIT,
          amount,
          currency,
        },
      ],

      requestedBy,
      metadata,
      source,
      correlationId,
      occurredAt:
        occurredAt || new Date(),
    };
  }

  /**
   * ===========================================================================
   * RECONCILIATION SUPPORT
   * ===========================================================================
   */

  async exists({
    tenantId,
    postingKey,
    session = null,
  } = {}) {
    const posting =
      await this.getPosting({
        tenantId,
        postingKey,
        session,
      });

    return Boolean(posting);
  }

  /**
   * ===========================================================================
   * AUDITING
   * ===========================================================================
   */

  async auditPosting(
    action,
    postingInput,
    posting,
  ) {
    if (
      !this.auditService ||
      typeof this.auditService.createAuditLog !==
        'function'
    ) {
      return;
    }

    try {
      await this.auditService.createAuditLog({
        tenantId:
          postingInput.tenantId,

        action,

        entityType:
          'LedgerPosting',

        entityId:
          posting?.id ||
          posting?._id?.toString() ||
          postingInput.postingKey,

        actorId:
          postingInput.requestedBy ||
          null,

        correlationId:
          postingInput.correlationId ||
          null,

        metadata: {
          postingKey:
            postingInput.postingKey,

          transactionId:
            postingInput.transactionId,

          paymentId:
            postingInput.paymentId,

          postingType:
            postingInput.postingType,

          currency:
            postingInput.currency,

          source:
            postingInput.source,
        },
      });
    } catch (error) {
      /**
       * Accounting posting has already succeeded.
       *
       * Audit failure MUST be observable and handled according to the platform
       * audit durability policy, but must not cause a successful financial
       * posting to be reported as failed after the commit has occurred.
       */
      this.logger?.error?.(
        {
          err: error,
          postingKey:
            postingInput.postingKey,
          transactionId:
            postingInput.transactionId,
        },
        'Ledger posting audit write failed after accounting operation',
      );
    }
  }

  /**
   * ===========================================================================
   * SERVICE HEALTH
   * ===========================================================================
   */

  async healthCheck() {
    if (
      typeof this.ledgerRepository.healthCheck !==
      'function'
    ) {
      return {
        healthy: true,
        repositoryHealthCheckSupported:
          false,
      };
    }

    try {
      const result =
        await this.ledgerRepository.healthCheck();

      return {
        healthy:
          result?.healthy !== false,
        repositoryHealthCheckSupported:
          true,
      };
    } catch (error) {
      return {
        healthy: false,
        repositoryHealthCheckSupported:
          true,
        error: error.message,
      };
    }
  }
}

/**
 * =============================================================================
 * FACTORY
 * =============================================================================
 */

/**
 * Create a configured LedgerPostingService.
 *
 * A factory is preferable to a hidden singleton because the repository is an
 * application dependency and should be injected by bootstrap/service
 * composition.
 *
 * @param {Object} dependencies
 * @returns {LedgerPostingService}
 */
export function createLedgerPostingService(
  dependencies,
) {
  return new LedgerPostingService(
    dependencies,
  );
}

/**
 * =============================================================================
 * DEFAULT EXPORT
 * =============================================================================
 *
 * Do not construct a fake repository here.
 *
 * The application bootstrap/service container should create the service:
 *
 *   const ledgerPostingService =
 *     createLedgerPostingService({
 *       ledgerRepository,
 *       auditService,
 *       logger,
 *     });
 */

export default LedgerPostingService;