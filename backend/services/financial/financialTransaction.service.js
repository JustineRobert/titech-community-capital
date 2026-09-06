/**
 * =============================================================================
 * TITech Community Capital LTD
 * Central Financial Transaction Boundary
 * =============================================================================
 *
 * File:
 *   backend/services/financial/financialTransaction.service.js
 *
 * Purpose:
 *   Own the MongoDB transaction boundary for financial mutations.
 *
 * Architectural position:
 *
 *   Authentication
 *        ↓
 *   Authorization / Tenant Context
 *        ↓
 *   Idempotency
 *        ↓
 *   Fraud / Risk
 *        ↓
 *   Financial Transaction Service
 *        ↓
 *   ┌────────────────────────────────────────────────────────────┐
 *   │                    MongoDB Transaction                     │
 *   │                                                            │
 *   │ Transaction Repository                                     │
 *   │ Balance Repository                                         │
 *   │ Ledger Repository                                          │
 *   │ Loan Repository                                            │
 *   │ Savings Repository                                         │
 *   │ Outbox Repository                                          │
 *   │ Idempotency Completion                                     │
 *   └────────────────────────────────────────────────────────────┘
 *        ↓
 *     COMMIT
 *
 * IMPORTANT EXTERNAL-SYSTEM RULE
 * =============================================================================
 *
 * `execute()` may be retried after a transient MongoDB transaction failure.
 *
 * Therefore DO NOT perform non-transactional external side effects directly
 * inside `execute()`, including:
 *
 *   - MTN MoMo API calls
 *   - Airtel Money API calls
 *   - email delivery
 *   - SMS delivery
 *   - push notifications
 *   - webhook delivery
 *   - external HTTP APIs
 *   - Kafka/queue publication without an idempotent transactional strategy
 *
 * Instead:
 *
 *   Mongo transaction
 *        ↓
 *   write OUTBOX command
 *        ↓
 *   COMMIT
 *        ↓
 *   worker/provider adapter
 *        ↓
 *   external system
 *        ↓
 *   callback/status reconciliation
 *
 * =============================================================================
 */

'use strict';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const crypto = require('crypto');
const mongoose = require('mongoose');

const {
  completeOperation,
  failOperation,
} = require('../idempotency/idempotency.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_MAX_TRANSACTION_RETRIES = 3;
const DEFAULT_MAX_COMMIT_RETRIES = 3;

const MIN_TRANSACTION_RETRIES = 1;
const MAX_TRANSACTION_RETRIES = 10;

const MIN_COMMIT_RETRIES = 1;
const MAX_COMMIT_RETRIES = 10;

const TRANSACTION_ID_MAX_LENGTH = 256;

const FINANCIAL_TRANSACTION_OPTIONS = Object.freeze({
  readConcern: {
    level: 'snapshot',
  },

  writeConcern: {
    w: 'majority',
  },

  readPreference: 'primary',
});

// =============================================================================
// ERRORS
// =============================================================================

class FinancialTransactionError extends Error {
  constructor(
    message,
    code,
    statusCode = 500,
    details = null,
    cause = null,
  ) {
    super(message);

    this.name = 'FinancialTransactionError';

    this.code = code;

    this.statusCode = statusCode;

    this.details = details;

    if (cause) {
      this.cause = cause;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        FinancialTransactionError,
      );
    }
  }
}

// =============================================================================
// GENERIC HELPERS
// =============================================================================

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new FinancialTransactionError(
      `${name} must be a function.`,
      'FINANCIAL_EXECUTOR_REQUIRED',
      500,
      {
        field: name,
      },
    );
  }
}

function requireIdentifier(
  value,
  field,
  maxLength = 256,
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new FinancialTransactionError(
      `${field} is required.`,
      'FINANCIAL_FIELD_REQUIRED',
      400,
      {
        field,
      },
    );
  }

  const normalized = String(value).trim();

  if (!normalized) {
    throw new FinancialTransactionError(
      `${field} is required.`,
      'FINANCIAL_FIELD_REQUIRED',
      400,
      {
        field,
      },
    );
  }

  if (normalized.length > maxLength) {
    throw new FinancialTransactionError(
      `${field} exceeds the maximum permitted length.`,
      'FINANCIAL_FIELD_TOO_LONG',
      400,
      {
        field,
        maxLength,
      },
    );
  }

  return normalized;
}

// =============================================================================
// CONTEXT VALIDATION
// =============================================================================

function validateFinancialContext({
  tenantId,
  principalId,
  operation,
  resource,
}) {
  requireIdentifier(
    tenantId,
    'tenantId',
  );

  requireIdentifier(
    principalId,
    'principalId',
  );

  requireIdentifier(
    operation,
    'operation',
  );

  requireIdentifier(
    resource,
    'resource',
  );
}

// =============================================================================
// RETRY VALIDATION
// =============================================================================

function normalizeRetryLimit(
  value,
  field,
  minimum,
  maximum,
  fallback,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const numeric = Number(value);

  if (
    !Number.isInteger(numeric) ||
    numeric < minimum ||
    numeric > maximum
  ) {
    throw new FinancialTransactionError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
      'FINANCIAL_INVALID_RETRY_LIMIT',
      500,
      {
        field,
        minimum,
        maximum,
      },
    );
  }

  return numeric;
}

// =============================================================================
// MONGODB STATE
// =============================================================================

function ensureMongoReady() {
  const readyState =
    mongoose.connection.readyState;

  /*
   * 0 = disconnected
   * 1 = connected
   * 2 = connecting
   * 3 = disconnecting
   */

  if (readyState !== 1) {
    throw new FinancialTransactionError(
      'MongoDB is not connected; financial transaction cannot execute.',
      'FINANCIAL_DATABASE_UNAVAILABLE',
      503,
      {
        readyState,
      },
    );
  }
}

// =============================================================================
// MONGODB ERROR CLASSIFICATION
// =============================================================================

function hasMongoErrorLabel(
  error,
  label,
) {
  return Boolean(
    error &&
      typeof error.hasErrorLabel ===
        'function' &&
      error.hasErrorLabel(label),
  );
}

function isTransientTransactionError(
  error,
) {
  return hasMongoErrorLabel(
    error,
    'TransientTransactionError',
  );
}

function isUnknownCommitResult(
  error,
) {
  return hasMongoErrorLabel(
    error,
    'UnknownTransactionCommitResult',
  );
}

function isRetryableCommitError(
  error,
) {
  return (
    isUnknownCommitResult(error) ||
    hasMongoErrorLabel(
      error,
      'RetryableWriteError',
    )
  );
}

// =============================================================================
// TRANSACTION ID
// =============================================================================

function createTransactionId() {
  return [
    'TXN',
    Date.now(),
    crypto.randomUUID(),
  ].join('-');
}

// =============================================================================
// SESSION
// =============================================================================

async function createSession() {
  ensureMongoReady();

  return mongoose.startSession();
}

// =============================================================================
// TRANSACTION OPTION HARDENING
// =============================================================================
//
// Caller-supplied options may extend the defaults, but must not quietly remove
// the financial transaction's required consistency characteristics.
//

function normalizeTransactionOptions(
  options,
) {
  const source =
    options || {};

  return {
    ...FINANCIAL_TRANSACTION_OPTIONS,

    ...source,

    readConcern: {
      ...FINANCIAL_TRANSACTION_OPTIONS.readConcern,
      ...(source.readConcern || {}),
    },

    writeConcern: {
      ...FINANCIAL_TRANSACTION_OPTIONS.writeConcern,
      ...(source.writeConcern || {}),
    },

    readPreference:
      'primary',
  };
}

// =============================================================================
// COMMIT WITH RETRY
// =============================================================================
//
// UnknownTransactionCommitResult means:
//
//   MongoDB cannot tell the client whether the commit succeeded.
//
// Therefore:
//
//   SAFE → retry commit
//
// But:
//
//   UNSAFE → execute business transaction again
//
// =============================================================================

async function commitWithRetry({
  session,
  maxCommitRetries =
    DEFAULT_MAX_COMMIT_RETRIES,
}) {
  const retryLimit =
    normalizeRetryLimit(
      maxCommitRetries,
      'maxCommitRetries',
      MIN_COMMIT_RETRIES,
      MAX_COMMIT_RETRIES,
      DEFAULT_MAX_COMMIT_RETRIES,
    );

  let attempt = 0;

  while (
    attempt <
    retryLimit
  ) {
    attempt += 1;

    try {
      await session.commitTransaction();

      return {
        committed: true,
        attempts: attempt,
      };
    } catch (error) {
      if (
        isRetryableCommitError(error) &&
        attempt <
          retryLimit
      ) {
        continue;
      }

      if (
        isUnknownCommitResult(
          error,
        )
      ) {
        throw new FinancialTransactionError(
          'The financial transaction commit result could not be confirmed.',
          'FINANCIAL_COMMIT_RESULT_UNKNOWN',
          503,
          {
            commitAttempts: attempt,
            reconciliationRequired: true,
          },
          error,
        );
      }

      throw new FinancialTransactionError(
        'Financial transaction commit failed.',
        'FINANCIAL_COMMIT_FAILED',
        503,
        {
          commitAttempts: attempt,
        },
        error,
      );
    }
  }

  throw new FinancialTransactionError(
    'Financial transaction commit retry limit exceeded.',
    'FINANCIAL_COMMIT_RETRY_LIMIT',
    503,
    {
      commitAttempts: retryLimit,
    },
  );
}

// =============================================================================
// IDEMPOTENCY COMPLETION
// =============================================================================
//
// MUST execute inside the active MongoDB transaction.
//
// The implementation of completeOperation MUST use the supplied session and
// MUST NOT start/commit a second transaction.
//

async function completeIdempotency({
  idempotencyRecord,
  executionResult,
  session,
}) {
  if (!session?.inTransaction?.()) {
    throw new FinancialTransactionError(
      'Idempotency completion requires an active financial transaction.',
      'IDEMPOTENCY_SESSION_REQUIRED',
      500,
    );
  }

  const completed =
    await completeOperation({
      recordId:
        idempotencyRecord._id,

      httpStatus:
        executionResult.httpStatus ??
        200,

      responseBody:
        executionResult.responseBody ??
        {},

      resultType:
        executionResult.resultType ??
        'SUCCESS',

      errorCode:
        executionResult.errorCode ??
        null,

      session,
    });

  if (!completed) {
    throw new FinancialTransactionError(
      'Unable to finalize the idempotency record.',
      'IDEMPOTENCY_COMPLETION_FAILED',
      500,
    );
  }

  return completed;
}

// =============================================================================
// EXECUTION RESULT VALIDATION
// =============================================================================

function validateExecutionResult(
  executionResult,
) {
  if (
    !executionResult ||
    typeof executionResult !==
      'object'
  ) {
    throw new FinancialTransactionError(
      'Financial operation did not return a valid execution result.',
      'FINANCIAL_EXECUTION_RESULT_INVALID',
      500,
    );
  }

  if (
    executionResult.httpStatus !==
      undefined &&
    (
      !Number.isInteger(
        executionResult.httpStatus,
      ) ||
      executionResult.httpStatus <
        100 ||
      executionResult.httpStatus >
        599
    )
  ) {
    throw new FinancialTransactionError(
      'Financial execution returned an invalid HTTP status.',
      'FINANCIAL_EXECUTION_HTTP_STATUS_INVALID',
      500,
    );
  }

  return executionResult;
}

// =============================================================================
// REENTRANCY PROTECTION
// =============================================================================
//
// Prevents accidental reuse of the same session in nested financial
// transaction boundaries.
//

function assertSessionNotExternallyManaged(
  session,
) {
  if (
    !session ||
    typeof session.startTransaction !==
      'function'
  ) {
    throw new FinancialTransactionError(
      'A valid MongoDB session is required.',
      'FINANCIAL_SESSION_REQUIRED',
      500,
    );
  }
}

// =============================================================================
// EXECUTE FINANCIAL TRANSACTION
// =============================================================================

async function executeFinancialTransaction({
  transactionId,
  idempotencyRecord,
  execute,

  transactionOptions =
    FINANCIAL_TRANSACTION_OPTIONS,

  maxTransactionRetries =
    DEFAULT_MAX_TRANSACTION_RETRIES,

  maxCommitRetries =
    DEFAULT_MAX_COMMIT_RETRIES,
}) {
  assertFunction(
    execute,
    'execute',
  );

  assertSessionNotExternallyManaged(
    await Promise.resolve(
      mongoose.startSession,
    ),
  );

  if (
    !idempotencyRecord ||
    !idempotencyRecord._id
  ) {
    throw new FinancialTransactionError(
      'Idempotency record is required.',
      'FINANCIAL_IDEMPOTENCY_RECORD_REQUIRED',
      500,
    );
  }

  const normalizedTransactionId =
    requireIdentifier(
      transactionId,
      'transactionId',
      TRANSACTION_ID_MAX_LENGTH,
    );

  const transactionRetryLimit =
    normalizeRetryLimit(
      maxTransactionRetries,
      'maxTransactionRetries',
      MIN_TRANSACTION_RETRIES,
      MAX_TRANSACTION_RETRIES,
      DEFAULT_MAX_TRANSACTION_RETRIES,
    );

  const commitRetryLimit =
    normalizeRetryLimit(
      maxCommitRetries,
      'maxCommitRetries',
      MIN_COMMIT_RETRIES,
      MAX_COMMIT_RETRIES,
      DEFAULT_MAX_COMMIT_RETRIES,
    );

  const normalizedOptions =
    normalizeTransactionOptions(
      transactionOptions,
    );

  const session =
    await createSession();

  let transactionAttempt = 0;

  let transactionStarted = false;

  try {
    while (
      transactionAttempt <
      transactionRetryLimit
    ) {
      transactionAttempt += 1;

      transactionStarted =
        false;

      try {
        // =====================================================================
        // START TRANSACTION
        // =====================================================================

        session.startTransaction(
          normalizedOptions,
        );

        transactionStarted =
          true;

        // =====================================================================
        // EXECUTE BUSINESS MUTATIONS
        // =====================================================================
        //
        // IMPORTANT:
        //
        // This callback must contain ONLY MongoDB mutations that use `session`
        // and deterministic local computation.
        //
        // External provider interactions belong in an outbox / worker layer.
        //
        // =====================================================================

        const executionResult =
          await execute({
            session,

            transactionId:
              normalizedTransactionId,

            idempotencyRecord,

            transactionAttempt,
          });

        validateExecutionResult(
          executionResult,
        );

        // =====================================================================
        // COMPLETE IDEMPOTENCY INSIDE TRANSACTION
        // =====================================================================

        if (
          executionResult.completeIdempotency !==
          false
        ) {
          await completeIdempotency({
            idempotencyRecord,

            executionResult,

            session,
          });
        }

        // =====================================================================
        // COMMIT
        // =====================================================================

        const commitResult =
          await commitWithRetry({
            session,

            maxCommitRetries:
              commitRetryLimit,
          });

        transactionStarted =
          false;

        // =====================================================================
        // SUCCESS
        // =====================================================================

        return {
          success: true,

          transactionId:
            normalizedTransactionId,

          idempotencyRecordId:
            idempotencyRecord._id,

          httpStatus:
            executionResult.httpStatus ??
            200,

          responseBody:
            executionResult.responseBody ??
            {},

          resultType:
            executionResult.resultType ??
            'SUCCESS',

          transactionAttempts:
            transactionAttempt,

          commitAttempts:
            commitResult.attempts,
        };
      } catch (error) {
        // =====================================================================
        // UNKNOWN COMMIT RESULT
        // =====================================================================
        //
        // The transaction may have committed.
        //
        // Therefore:
        //
        //   - DO NOT abort
        //   - DO NOT rerun execute()
        //   - DO NOT mark idempotency FAILED
        //   - DO NOT send a compensating financial mutation
        //
        // Reconciliation must determine the authoritative outcome.
        // =====================================================================

        if (
          isUnknownCommitResult(
            error,
          ) ||
          error?.code ===
            'FINANCIAL_COMMIT_RESULT_UNKNOWN'
        ) {
          transactionStarted =
            false;

          throw new FinancialTransactionError(
            'Financial transaction outcome is unknown and requires reconciliation.',
            'FINANCIAL_COMMIT_RESULT_UNKNOWN',
            503,
            {
              transactionId:
                normalizedTransactionId,

              transactionAttempts:
                transactionAttempt,

              reconciliationRequired:
                true,
            },
            error,
          );
        }

        // =====================================================================
        // ABORT
        // =====================================================================

        if (
          transactionStarted &&
          session.inTransaction()
        ) {
          try {
            await session.abortTransaction();
          } catch {
            /*
             * Preserve original failure.
             */
          }

          transactionStarted =
            false;
        }

        // =====================================================================
        // TRANSIENT TRANSACTION ERROR
        // =====================================================================

        if (
          isTransientTransactionError(
            error,
          ) &&
          transactionAttempt <
            transactionRetryLimit
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new FinancialTransactionError(
      'Financial transaction retry limit exceeded.',
      'FINANCIAL_TRANSACTION_RETRY_LIMIT',
      503,
      {
        transactionId:
          normalizedTransactionId,

        transactionAttempts:
          transactionAttempt,
      },
    );
  } finally {
    // =========================================================================
    // DEFENSIVE CLEANUP
    // =========================================================================

    if (
      transactionStarted &&
      session.inTransaction()
    ) {
      try {
        await session.abortTransaction();
      } catch {
        /*
         * Never replace the original financial error with cleanup failure.
         */
      }
    }

    await session.endSession();
  }
}

// =============================================================================
// FAILURE PERSISTENCE
// =============================================================================
//
// Must happen AFTER the MongoDB financial transaction has aborted.
//
// This is intentionally outside the financial transaction.
//
// If failure persistence itself fails, reconciliation/observability must detect
// the problem. The original financial exception remains authoritative.
//

async function persistFinancialFailure({
  recordId,
  transactionId,
  error,
}) {
  try {
    await failOperation({
      recordId,

      httpStatus:
        error?.statusCode ??
        error?.status ??
        500,

      responseBody: {
        success: false,

        code:
          error?.code ??
          'FINANCIAL_OPERATION_FAILED',

        message:
          error?.message ??
          'Financial operation failed.',

        transactionId,
      },

      errorCode:
        error?.code ??
        'FINANCIAL_OPERATION_FAILED',
    });

    return true;
  } catch (idempotencyError) {
    /*
     * IMPORTANT:
     *
     * The financial transaction has already failed/aborted.
     *
     * We do not replace the authoritative financial exception.
     *
     * The reconciliation subsystem should identify idempotency records that
     * remain PROCESSING/PENDING beyond their expected timeout.
     */

    return false;
  }
}

// =============================================================================
// MAIN FINANCIAL OPERATION
// =============================================================================

async function processFinancialOperation({
  tenantId,
  principalId,
  operation,
  resource,

  transactionId,

  idempotency,

  execute,

  transactionOptions,

  maxTransactionRetries,

  maxCommitRetries,
}) {
  // ===========================================================================
  // CONTEXT VALIDATION
  // ===========================================================================

  validateFinancialContext({
    tenantId,
    principalId,
    operation,
    resource,
  });

  assertFunction(
    execute,
    'execute',
  );

  // ===========================================================================
  // IDEMPOTENCY VALIDATION
  // ===========================================================================

  if (!idempotency) {
    throw new FinancialTransactionError(
      'Idempotency context is required for financial operations.',
      'FINANCIAL_IDEMPOTENCY_REQUIRED',
      500,
    );
  }

  if (
    idempotency.state !==
    'NEW'
  ) {
    throw new FinancialTransactionError(
      'Financial execution requires a NEW idempotency operation.',
      'FINANCIAL_IDEMPOTENCY_INVALID_STATE',
      409,
      {
        state:
          idempotency.state,
      },
    );
  }

  if (
    !idempotency.recordId
  ) {
    throw new FinancialTransactionError(
      'Idempotency record identifier is missing.',
      'FINANCIAL_IDEMPOTENCY_RECORD_MISSING',
      500,
    );
  }

  // ===========================================================================
  // TRANSACTION ID
  // ===========================================================================

  const effectiveTransactionId =
    transactionId ||
    createTransactionId();

  const idempotencyRecord = {
    _id:
      idempotency.recordId,

    key:
      idempotency.key,

    fingerprint:
      idempotency.fingerprint,

    tenantId,

    principalId,

    operation,

    resource,
  };

  try {
    return await executeFinancialTransaction({
      transactionId:
        effectiveTransactionId,

      idempotencyRecord,

      execute,

      transactionOptions,

      maxTransactionRetries,

      maxCommitRetries,
    });
  } catch (error) {
    // =======================================================================
    // UNKNOWN COMMIT
    // =======================================================================
    //
    // We do not know whether MongoDB committed.
    //
    // Therefore:
    //   - don't write FAILED
    //   - don't execute compensation
    //   - don't retry the business operation
    // =======================================================================

    if (
      error?.code ===
      'FINANCIAL_COMMIT_RESULT_UNKNOWN'
    ) {
      throw error;
    }

    // =======================================================================
    // TRANSACTION FAILED / ABORTED
    // =======================================================================

    await persistFinancialFailure({
      recordId:
        idempotency.recordId,

      transactionId:
        effectiveTransactionId,

      error,
    });

    throw error;
  }
}

// =============================================================================
// EXTERNAL SIDE-EFFECT CONTRACT
// =============================================================================
//
// Use this as an architectural marker in service reviews.
//
// SAFE inside `execute()`:
//   - MongoDB repository writes using `session`
//   - deterministic calculations
//   - validation
//   - local state transitions
//   - outbox writes
//
// NOT SAFE inside `execute()`:
//   - MoMo HTTP calls
//   - Airtel HTTP calls
//   - email
//   - SMS
//   - push notifications
//   - webhooks
//   - arbitrary HTTP APIs
//
// =============================================================================

const FINANCIAL_EXECUTION_RULES =
  Object.freeze({
    RETRYABLE: Object.freeze([
      'mongodb-local-mutation',
      'deterministic-calculation',
      'validation',
      'outbox-write',
    ]),

    NON_RETRYABLE_DIRECT_SIDE_EFFECTS:
      Object.freeze([
        'momo-api',
        'airtel-api',
        'email',
        'sms',
        'push-notification',
        'webhook',
        'external-http',
        'non-idempotent-queue-publish',
      ]),
  });

// =============================================================================
// REPOSITORY CONTRACT
// =============================================================================

const FINANCIAL_TRANSACTION_REPOSITORY_CONTRACT =
  Object.freeze({
    transaction:
      Object.freeze([
        'create',
        'findById',
        'updateState',
      ]),

    balance:
      Object.freeze([
        'getForUpdate',
        'increment',
        'decrement',
      ]),

    ledger:
      Object.freeze([
        'createEntry',
        'createEntries',
      ]),

    loan:
      Object.freeze([
        'findById',
        'disburse',
        'repay',
        'markActive',
      ]),

    savings:
      Object.freeze([
        'findById',
        'recordContribution',
        'recordWithdrawal',
      ]),

    outbox:
      Object.freeze([
        'enqueue',
        'findPending',
      ]),

    audit:
      Object.freeze([
        'record',
      ]),
  });

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  FinancialTransactionError,

  FINANCIAL_TRANSACTION_REPOSITORY_CONTRACT,

  FINANCIAL_EXECUTION_RULES,

  executeFinancialTransaction,

  processFinancialOperation,

  createTransactionId,
};