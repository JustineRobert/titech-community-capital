'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Recovery Service
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/transactionRecoveryService.js
 *
 * Purpose
 * -------
 * Production-grade recovery orchestration for financially material
 * transactions that enter ambiguous, failed, expired, interrupted, or
 * reconciliation-required states.
 *
 * This service is responsible for RECOVERY, not for inventing financial truth.
 *
 * Recovery Principle
 * ------------------
 * A transaction must never be "fixed" by overwriting history.
 *
 * Recovery works by:
 *
 *   1. Loading authoritative transaction state.
 *   2. Validating tenant / identity / ownership.
 *   3. Inspecting the transaction state machine.
 *   4. Determining whether recovery is safe.
 *   5. Correlating external/provider evidence when available.
 *   6. Checking idempotency.
 *   7. Reconciling financial side effects.
 *   8. Creating compensating/reversal instructions where appropriate.
 *   9. Persisting recovery state atomically.
 *  10. Publishing durable recovery events.
 *
 * Enterprise Rules
 * ---------------
 * 1. No financial record is ever edited in-place to change historical truth.
 * 2. Successful financial transactions are not downgraded.
 * 3. Unknown outcomes are never converted into "FAILED" merely because a
 *    timeout occurred.
 * 4. An external side effect may not be repeated without evidence that the
 *    previous operation did not succeed.
 * 5. Recovery is idempotent.
 * 6. Recovery attempts are versioned and auditable.
 * 7. Tenant boundaries are enforced on every lookup and mutation.
 * 8. Reversal is represented as a compensating transaction.
 * 9. Ledger integrity remains owned by the ledger/posting engine.
 * 10. Recovery does not directly mutate balances.
 * 11. Recovery can hand off unresolved cases to reconciliation/investigation.
 * 12. Every recovery path produces a deterministic operation identity.
 * 13. Concurrency is controlled with optimistic version checks where possible.
 * 14. Provider/reference mismatches fail closed.
 * 15. Recovery failures must themselves be observable and recoverable.
 *
 * Typical States Requiring Recovery
 * ---------------------------------
 *   PENDING
 *   PROCESSING
 *   RETRYING
 *   UNKNOWN
 *   EXPIRED
 *   FAILED
 *   REQUIRES_RECONCILIATION
 *   DEAD_LETTER
 *
 * Typical Recovery Outcomes
 * -------------------------
 *   RECOVERED
 *   ALREADY_RECOVERED
 *   RETRY_REQUIRED
 *   RECONCILIATION_REQUIRED
 *   COMPENSATION_REQUIRED
 *   COMPENSATED
 *   NO_ACTION_REQUIRED
 *   BLOCKED
 *   FAILED
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const RECOVERY_STATES = Object.freeze({
  NOT_STARTED:
    'NOT_STARTED',

  EVALUATING:
    'EVALUATING',

  RECOVERING:
    'RECOVERING',

  RECOVERED:
    'RECOVERED',

  RETRY_REQUIRED:
    'RETRY_REQUIRED',

  RECONCILIATION_REQUIRED:
    'RECONCILIATION_REQUIRED',

  COMPENSATION_REQUIRED:
    'COMPENSATION_REQUIRED',

  COMPENSATED:
    'COMPENSATED',

  NO_ACTION_REQUIRED:
    'NO_ACTION_REQUIRED',

  BLOCKED:
    'BLOCKED',

  FAILED:
    'FAILED',
});

const RECOVERY_OUTCOMES = Object.freeze({
  RECOVERED:
    'RECOVERED',

  ALREADY_RECOVERED:
    'ALREADY_RECOVERED',

  RETRY_REQUIRED:
    'RETRY_REQUIRED',

  RECONCILIATION_REQUIRED:
    'RECONCILIATION_REQUIRED',

  COMPENSATION_REQUIRED:
    'COMPENSATION_REQUIRED',

  COMPENSATED:
    'COMPENSATED',

  NO_ACTION_REQUIRED:
    'NO_ACTION_REQUIRED',

  BLOCKED:
    'BLOCKED',

  FAILED:
    'FAILED',
});

const RECOVERY_REASON_CODES = Object.freeze({
  UNKNOWN_OUTCOME:
    'UNKNOWN_OUTCOME',

  PROVIDER_TIMEOUT:
    'PROVIDER_TIMEOUT',

  PROVIDER_UNAVAILABLE:
    'PROVIDER_UNAVAILABLE',

  PAYMENT_STATE_STALE:
    'PAYMENT_STATE_STALE',

  FINANCIAL_POSTING_UNKNOWN:
    'FINANCIAL_POSTING_UNKNOWN',

  FINANCIAL_POSTING_FAILED:
    'FINANCIAL_POSTING_FAILED',

  SETTLEMENT_UNKNOWN:
    'SETTLEMENT_UNKNOWN',

  SETTLEMENT_MISMATCH:
    'SETTLEMENT_MISMATCH',

  DEAD_LETTER_REPROCESS:
    'DEAD_LETTER_REPROCESS',

  WORKER_CRASH:
    'WORKER_CRASH',

  REQUEST_TIMEOUT:
    'REQUEST_TIMEOUT',

  CALLBACK_MISSED:
    'CALLBACK_MISSED',

  RECONCILIATION_REPAIR:
    'RECONCILIATION_REPAIR',

  MANUAL_RECOVERY:
    'MANUAL_RECOVERY',

  SYSTEM_RECOVERY:
    'SYSTEM_RECOVERY',

  DUPLICATE_OPERATION:
    'DUPLICATE_OPERATION',

  UNKNOWN:
    'UNKNOWN',
});

const RECOVERY_ACTIONS = Object.freeze({
  NO_ACTION:
    'NO_ACTION',

  RETRY_PROVIDER_STATUS:
    'RETRY_PROVIDER_STATUS',

  RETRY_OPERATION:
    'RETRY_OPERATION',

  VERIFY_FINANCIAL_POSTING:
    'VERIFY_FINANCIAL_POSTING',

  CREATE_REVERSAL:
    'CREATE_REVERSAL',

  CREATE_ADJUSTMENT:
    'CREATE_ADJUSTMENT',

  OPEN_RECONCILIATION:
    'OPEN_RECONCILIATION',

  RELEASE_STALE_LEASE:
    'RELEASE_STALE_LEASE',

  MARK_RECOVERED:
    'MARK_RECOVERED',

  BLOCK_OPERATION:
    'BLOCK_OPERATION',
});

const RECOVERY_OPERATION_TYPES = Object.freeze({
  TRANSACTION_RECOVERY:
    'TRANSACTION_RECOVERY',

  PROVIDER_STATUS_RECOVERY:
    'PROVIDER_STATUS_RECOVERY',

  FINANCIAL_RECOVERY:
    'FINANCIAL_RECOVERY',

  SETTLEMENT_RECOVERY:
    'SETTLEMENT_RECOVERY',

  REVERSAL_RECOVERY:
    'REVERSAL_RECOVERY',

  RECONCILIATION_REPAIR:
    'RECONCILIATION_REPAIR',
});

const RECOVERY_EVENT_TYPES = Object.freeze({
  STARTED:
    'TransactionRecoveryStarted',

  EVALUATED:
    'TransactionRecoveryEvaluated',

  RETRY_REQUIRED:
    'TransactionRecoveryRetryRequired',

  RECOVERED:
    'TransactionRecovered',

  RECONCILIATION_REQUIRED:
    'TransactionRecoveryReconciliationRequired',

  COMPENSATION_REQUIRED:
    'TransactionRecoveryCompensationRequired',

  COMPENSATED:
    'TransactionRecoveredByCompensation',

  BLOCKED:
    'TransactionRecoveryBlocked',

  FAILED:
    'TransactionRecoveryFailed',

  NO_ACTION:
    'TransactionRecoveryNoActionRequired',
});

const RECOVERY_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'TRANSACTION_RECOVERY_INVALID_REQUEST',

  TENANT_REQUIRED:
    'TRANSACTION_RECOVERY_TENANT_REQUIRED',

  TENANT_MISMATCH:
    'TRANSACTION_RECOVERY_TENANT_MISMATCH',

  TRANSACTION_ID_REQUIRED:
    'TRANSACTION_RECOVERY_TRANSACTION_ID_REQUIRED',

  TRANSACTION_NOT_FOUND:
    'TRANSACTION_RECOVERY_TRANSACTION_NOT_FOUND',

  RECOVERY_NOT_FOUND:
    'TRANSACTION_RECOVERY_RECORD_NOT_FOUND',

  INVALID_STATE:
    'TRANSACTION_RECOVERY_INVALID_STATE',

  INVALID_TRANSITION:
    'TRANSACTION_RECOVERY_INVALID_TRANSITION',

  ALREADY_RECOVERED:
    'TRANSACTION_RECOVERY_ALREADY_RECOVERED',

  SUCCESSFUL_TRANSACTION:
    'TRANSACTION_RECOVERY_SUCCESSFUL_TRANSACTION',

  HISTORY_EDIT_FORBIDDEN:
    'TRANSACTION_RECOVERY_HISTORY_EDIT_FORBIDDEN',

  IDEMPOTENCY_REQUIRED:
    'TRANSACTION_RECOVERY_IDEMPOTENCY_REQUIRED',

  IDEMPOTENCY_CONFLICT:
    'TRANSACTION_RECOVERY_IDEMPOTENCY_CONFLICT',

  CONCURRENT_UPDATE:
    'TRANSACTION_RECOVERY_CONCURRENT_UPDATE',

  PROVIDER_REFERENCE_REQUIRED:
    'TRANSACTION_RECOVERY_PROVIDER_REFERENCE_REQUIRED',

  PROVIDER_REFERENCE_MISMATCH:
    'TRANSACTION_RECOVERY_PROVIDER_REFERENCE_MISMATCH',

  PROVIDER_STATUS_UNAVAILABLE:
    'TRANSACTION_RECOVERY_PROVIDER_STATUS_UNAVAILABLE',

  FINANCIAL_TRANSACTION_NOT_FOUND:
    'TRANSACTION_RECOVERY_FINANCIAL_TRANSACTION_NOT_FOUND',

  FINANCIAL_POSTING_UNKNOWN:
    'TRANSACTION_RECOVERY_FINANCIAL_POSTING_UNKNOWN',

  REVERSAL_REQUIRED:
    'TRANSACTION_RECOVERY_REVERSAL_REQUIRED',

  REVERSAL_FAILED:
    'TRANSACTION_RECOVERY_REVERSAL_FAILED',

  RECONCILIATION_REQUIRED:
    'TRANSACTION_RECOVERY_RECONCILIATION_REQUIRED',

  RECONCILIATION_UNAVAILABLE:
    'TRANSACTION_RECOVERY_RECONCILIATION_UNAVAILABLE',

  PERSISTENCE_UNAVAILABLE:
    'TRANSACTION_RECOVERY_PERSISTENCE_UNAVAILABLE',

  EVENT_PUBLISH_FAILED:
    'TRANSACTION_RECOVERY_EVENT_PUBLISH_FAILED',

  UNSUPPORTED_ACTION:
    'TRANSACTION_RECOVERY_UNSUPPORTED_ACTION',

  CONFIGURATION_ERROR:
    'TRANSACTION_RECOVERY_CONFIGURATION_ERROR',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode:
    true,

  requireTenant:
    true,

  requireIdempotency:
    true,

  /**
   * Successful transactions are authoritative and are never downgraded.
   */
  protectSuccessfulTransactions:
    true,

  /**
   * Recovered financial state should be preserved through compensating
   * transactions, never by editing the original record.
   */
  prohibitHistoricalMutation:
    true,

  /**
   * Unknown external outcomes require evidence/reconciliation.
   */
  requireEvidenceForUnknownResolution:
    true,

  /**
   * Allow provider status query when the transaction has a provider reference.
   */
  allowProviderStatusRecovery:
    true,

  providerStatusTimeoutMs:
    15000,

  /**
   * Allow financial-posting verification through injected financial service.
   */
  verifyFinancialState:
    true,

  /**
   * Create compensating reversal instructions when an operation succeeded
   * externally but internal processing cannot be completed safely.
   */
  allowCompensation:
    true,

  /**
   * Require explicit reconciliation handoff for unresolved cases.
   */
  enableReconciliation:
    true,

  /**
   * Durable event publication.
   */
  publishEvents:
    true,

  failOnEventPublicationError:
    true,

  /**
   * Idempotent retries: never execute a second external financial operation
   * merely because the first execution timed out.
   */
  neverDuplicateUnknownExternalOperation:
    true,

  /**
   * Recovery leases prevent two workers from recovering the same operation.
   */
  recoveryLeaseMs:
    5 * 60 * 1000,

  /**
   * Maximum number of automatic recovery attempts.
   */
  maxAutomaticRecoveryAttempts:
    5,

  /**
   * Prevent infinite recovery loops.
   */
  maxRecoveryDepth:
    10,

  /**
   * Persist complete recovery history.
   */
  retainRecoveryHistory:
    true,
});

/* ============================================================================
 * Error
 * ========================================================================== */

class TransactionRecoveryError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'TransactionRecoveryError';

    this.code =
      options.code ||
      RECOVERY_ERROR_CODES
        .INVALID_REQUEST;

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 409;

    this.transactionId =
      options.transactionId ||
      null;

    this.recoveryId =
      options.recoveryId ||
      null;

    this.tenantId =
      options.tenantId ||
      null;

    this.operationId =
      options.operationId ||
      null;

    this.retryable =
      options.retryable === true;

    this.unknownOutcome =
      options.unknownOutcome === true;

    this.reconciliationRequired =
      options.reconciliationRequired === true;

    this.details =
      options.details ||
      {};

    if (options.cause) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      TransactionRecoveryError,
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

function normalizeStatus(
  value,
) {
  const status =
    normalizeString(value);

  return status
    ? status.toUpperCase()
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

  return normalizeString(value);
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
    typeof value.toString ===
      'function'
  ) {
    return value.toString();
  }

  return null;
}

function canonicalAmount(
  value,
) {
  const amount =
    normalizeAmount(
      value,
    );

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

function normalizeProvider(
  value,
) {
  const provider =
    normalizeString(
      value,
    );

  return provider
    ? provider.toLowerCase()
    : null;
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
      typeof value === 'string'
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

function createRecoveryId() {
  return `recovery_${crypto.randomUUID()}`;
}

function createOperationId() {
  return `recovery_op_${crypto.randomUUID()}`;
}

/* ============================================================================
 * Transaction Recovery Service
 * ========================================================================== */

class TransactionRecoveryService {
  /**
   * @param {Object} dependencies
   *
   * Core:
   *   transactionRepository
   *   recoveryRepository
   *   transactionStateMachine
   *   idempotencyService
   *
   * Financial:
   *   financialService
   *   transactionPostingService
   *   ledgerService
   *   reversalService
   *
   * Provider:
   *   providerRegistry
   *   providerStatusService
   *
   * Reconciliation:
   *   reconciliationService
   *
   * Events:
   *   eventPublisher
   *   transactionEventPublisher
   *
   * Observability:
   *   auditService
   *   metrics
   *   logger
   */
  constructor(
    dependencies = {},
  ) {
    this.transactionRepository =
      dependencies.transactionRepository ||
      null;

    this.recoveryRepository =
      dependencies.recoveryRepository ||
      dependencies.transactionRecoveryRepository ||
      null;

    this.transactionStateMachine =
      dependencies.transactionStateMachine ||
      null;

    this.idempotencyService =
      dependencies.idempotencyService ||
      dependencies.transactionIdempotencyService ||
      null;

    this.financialService =
      dependencies.financialService ||
      dependencies.transactionPostingService ||
      null;

    this.ledgerService =
      dependencies.ledgerService ||
      null;

    this.reversalService =
      dependencies.reversalService ||
      null;

    this.providerRegistry =
      dependencies.providerRegistry ||
      null;

    this.providerStatusService =
      dependencies.providerStatusService ||
      null;

    this.reconciliationService =
      dependencies.reconciliationService ||
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
   * Primary Recovery Entry Point
   * ======================================================================== */

  /**
   * Recover one transaction.
   *
   * @param {string|Object} transactionOrId
   * @param {Object} rawContext
   *
   * Supported explicit signals:
   *   context.reasonCode
   *   context.providerEvidence
   *   context.financialEvidence
   *   context.recoveryAction
   *   context.forceReview
   */
  async recover(
    transactionOrId,
    rawContext = {},
  ) {
    const context =
      this._normalizeContext(
        rawContext,
      );

    context.operationId =
      context.operationId ||
      createOperationId();

    this._assertContext(
      context,
    );

    const transaction =
      await this._loadTransaction(
        transactionOrId,
        context,
      );

    await this._validateTransactionTenant(
      transaction,
      context,
    );

    /**
     * Protect historically authoritative final transactions.
     */
    if (
      this._isSuccessfulTransaction(
        transaction,
      )
      &&
      this.options
        .protectSuccessfulTransactions
    ) {
      return this._buildResult(
        transaction,
        null,
        context,
        {
          outcome:
            RECOVERY_OUTCOMES
              .NO_ACTION_REQUIRED,

          reasonCode:
            RECOVERY_REASON_CODES
              .DUPLICATE_OPERATION,

          message:
            'Transaction is already successful and requires no recovery.',
        },
      );
    }

    const idempotency =
      await this._reserveRecoveryIdempotency(
        transaction,
        context,
      );

    if (
      idempotency.completed
      && idempotency.result
    ) {
      return this._buildReplayResult(
        transaction,
        idempotency,
        context,
      );
    }

    const recovery =
      await this._getOrCreateRecoveryRecord(
        transaction,
        context,
      );

    const recoveryLease =
      await this._acquireRecoveryLease(
        recovery,
        context,
      );

    if (
      recoveryLease.recoveredByAnotherWorker
    ) {
      return this._buildResult(
        transaction,
        recovery,
        context,
        {
          outcome:
            RECOVERY_OUTCOMES
              .RETRY_REQUIRED,

          reasonCode:
            RECOVERY_REASON_CODES
              .DUPLICATE_OPERATION,

          message:
            'Another recovery worker currently owns the recovery lease.',
        },
      );
    }

    await this._markRecoveryStarted(
      recovery,
      transaction,
      context,
    );

    await this._publishEvent(
      RECOVERY_EVENT_TYPES.STARTED,
      transaction,
      recovery,
      context,
    );

    try {
      const evaluation =
        await this._evaluateRecovery(
          transaction,
          recovery,
          context,
        );

      await this._persistEvaluation(
        recovery,
        evaluation,
        transaction,
        context,
      );

      await this._publishEvent(
        RECOVERY_EVENT_TYPES.EVALUATED,
        transaction,
        recovery,
        {
          ...context,
          metadata: {
            ...(context.metadata || {}),
            evaluation: {
              action:
                evaluation.action,
              confidence:
                evaluation.confidence,
              reasonCode:
                evaluation.reasonCode,
            },
          },
        },
      );

      const result =
        await this._executeRecoveryAction(
          transaction,
          recovery,
          evaluation,
          context,
        );

      await this._completeRecovery(
        recovery,
        transaction,
        result,
        context,
      );

      await this._completeIdempotency(
        idempotency,
        result,
        transaction,
        context,
      );

      return this._buildResult(
        transaction,
        recovery,
        context,
        result,
      );
    } catch (error) {
      const failure =
        await this._handleRecoveryFailure(
          transaction,
          recovery,
          idempotency,
          error,
          context,
        );

      if (
        failure
        && failure.result
      ) {
        return this._buildResult(
          transaction,
          recovery,
          context,
          failure.result,
        );
      }

      throw error instanceof
        TransactionRecoveryError
        ? error
        : new TransactionRecoveryError(
            error?.message ||
              'Transaction recovery failed.',
            {
              code:
                error?.code ||
                RECOVERY_ERROR_CODES
                  .INVALID_REQUEST,

              statusCode:
                Number(
                  error?.statusCode,
                ) || 503,

              transactionId:
                transaction.id,

              recoveryId:
                recovery.id,

              tenantId:
                context.tenantId,

              operationId:
                context.operationId,

              retryable:
                error?.retryable === true,

              unknownOutcome:
                error?.unknownOutcome ===
                true,

              reconciliationRequired:
                error?.reconciliationRequired ===
                true,

              cause:
                error,
            },
          );
    }
  }

  /* ==========================================================================
   * Evaluation
   * ======================================================================== */

  async _evaluateRecovery(
    transaction,
    recovery,
    context,
  ) {
    const state =
      normalizeStatus(
        transaction.status ||
          transaction.state,
      );

    const reasonCode =
      context.reasonCode ||
      recovery.reasonCode ||
      RECOVERY_REASON_CODES.UNKNOWN;

    const recoveryAttempts =
      Number(
        recovery.recoveryAttempts ||
          0,
      );

    if (
      recoveryAttempts >=
      this.options.maxAutomaticRecoveryAttempts
    ) {
      return {
        action:
          RECOVERY_ACTIONS
            .OPEN_RECONCILIATION,

        outcome:
          RECOVERY_OUTCOMES
            .RECONCILIATION_REQUIRED,

        confidence:
          'HIGH',

        reasonCode:
          'MAX_RECOVERY_ATTEMPTS_REACHED',

        details: {
          recoveryAttempts,
        },
      };
    }

    /**
     * Explicit operator/manual request has precedence over heuristics.
     */
    if (
      context.recoveryAction
    ) {
      return this._evaluateExplicitAction(
        transaction,
        context.recoveryAction,
        context,
      );
    }

    if (
      context.providerEvidence
    ) {
      return this._evaluateProviderEvidence(
        transaction,
        context.providerEvidence,
        context,
      );
    }

    if (
      context.financialEvidence
    ) {
      return this._evaluateFinancialEvidence(
        transaction,
        context.financialEvidence,
        context,
      );
    }

    switch (state) {
      case 'UNKNOWN':
      case 'PROCESSING':
      case 'PENDING':
      case 'RETRYING':
        if (
          this.options
            .allowProviderStatusRecovery
          &&
          transaction.providerTransactionId
        ) {
          return {
            action:
              RECOVERY_ACTIONS
                .RETRY_PROVIDER_STATUS,

            outcome:
              RECOVERY_OUTCOMES
                .RETRY_REQUIRED,

            confidence:
              'MEDIUM',

            reasonCode,

            details: {
              providerTransactionId:
                transaction.providerTransactionId,
            },
          };
        }

        return {
          action:
            RECOVERY_ACTIONS
              .OPEN_RECONCILIATION,

          outcome:
            RECOVERY_OUTCOMES
              .RECONCILIATION_REQUIRED,

          confidence:
            'HIGH',

          reasonCode,

          details: {},
        };

      case 'FAILED':
        return this._evaluateFailedTransaction(
          transaction,
          reasonCode,
          context,
        );

      case 'EXPIRED':
        return {
          action:
            RECOVERY_ACTIONS
              .OPEN_RECONCILIATION,

          outcome:
            RECOVERY_OUTCOMES
              .RECONCILIATION_REQUIRED,

          confidence:
            'MEDIUM',

          reasonCode:
            RECOVERY_REASON_CODES
              .PAYMENT_STATE_STALE,

          details: {
            currentState:
              state,
          },
        };

      case 'REQUIRES_RECONCILIATION':
      case 'DEAD_LETTER':
        return {
          action:
            RECOVERY_ACTIONS
              .OPEN_RECONCILIATION,

          outcome:
            RECOVERY_OUTCOMES
              .RECONCILIATION_REQUIRED,

          confidence:
            'HIGH',

          reasonCode,

          details: {},
        };

      case 'CANCELLED':
        return {
          action:
            RECOVERY_ACTIONS
              .NO_ACTION,

          outcome:
            RECOVERY_OUTCOMES
              .NO_ACTION_REQUIRED,

          confidence:
            'HIGH',

          reasonCode,
        };

      default:
        return {
          action:
            RECOVERY_ACTIONS
              .OPEN_RECONCILIATION,

          outcome:
            RECOVERY_OUTCOMES
              .RECONCILIATION_REQUIRED,

          confidence:
            'LOW',

          reasonCode:
            RECOVERY_REASON_CODES
              .UNKNOWN,

          details: {
            currentState:
              state,
          },
        };
    }
  }

  _evaluateExplicitAction(
    transaction,
    action,
    context,
  ) {
    const normalized =
      normalizeString(
        action,
      )?.toUpperCase();

    if (
      !Object.values(
        RECOVERY_ACTIONS,
      ).includes(
        normalized,
      )
    ) {
      throw new TransactionRecoveryError(
        'Unsupported transaction recovery action.',
        {
          code:
            RECOVERY_ERROR_CODES
              .UNSUPPORTED_ACTION,

          statusCode:
            400,

          transactionId:
            transaction.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    switch (
      normalized
    ) {
      case RECOVERY_ACTIONS
        .RETRY_PROVIDER_STATUS:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .RETRY_REQUIRED,

          confidence:
            'HIGH',

          reasonCode:
            context.reasonCode ||
            RECOVERY_REASON_CODES
              .MANUAL_RECOVERY,
        };

      case RECOVERY_ACTIONS
        .VERIFY_FINANCIAL_POSTING:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .RETRY_REQUIRED,

          confidence:
            'HIGH',

          reasonCode:
            context.reasonCode ||
            RECOVERY_REASON_CODES
              .FINANCIAL_POSTING_UNKNOWN,
        };

      case RECOVERY_ACTIONS
        .CREATE_REVERSAL:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .COMPENSATION_REQUIRED,

          confidence:
            'HIGH',

          reasonCode:
            context.reasonCode ||
            RECOVERY_REASON_CODES
              .MANUAL_RECOVERY,
        };

      case RECOVERY_ACTIONS
        .OPEN_RECONCILIATION:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .RECONCILIATION_REQUIRED,

          confidence:
            'HIGH',

          reasonCode:
            context.reasonCode ||
            RECOVERY_REASON_CODES
              .MANUAL_RECOVERY,
        };

      case RECOVERY_ACTIONS
        .RELEASE_STALE_LEASE:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .RECOVERED,

          confidence:
            'HIGH',

          reasonCode:
            context.reasonCode ||
            RECOVERY_REASON_CODES
              .SYSTEM_RECOVERY,
        };

      case RECOVERY_ACTIONS
        .MARK_RECOVERED:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .RECOVERED,

          confidence:
            'HIGH',

          reasonCode:
            context.reasonCode ||
            RECOVERY_REASON_CODES
              .MANUAL_RECOVERY,
        };

      case RECOVERY_ACTIONS
        .NO_ACTION:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .NO_ACTION_REQUIRED,

          confidence:
            'HIGH',

          reasonCode:
            context.reasonCode ||
            RECOVERY_REASON_CODES
              .MANUAL_RECOVERY,
        };

      case RECOVERY_ACTIONS
        .BLOCK_OPERATION:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .BLOCKED,

          confidence:
            'HIGH',

          reasonCode:
            context.reasonCode ||
            RECOVERY_REASON_CODES
              .MANUAL_RECOVERY,
        };

      default:
        return {
          action:
            normalized,

          outcome:
            RECOVERY_OUTCOMES
              .FAILED,

          confidence:
            'LOW',

          reasonCode:
            RECOVERY_REASON_CODES
              .UNKNOWN,
        };
    }
  }

  _evaluateProviderEvidence(
    transaction,
    evidence,
    context,
  ) {
    const outcome =
      this._normalizeProviderOutcome(
        evidence,
      );

    if (
      outcome === 'SUCCESS'
    ) {
      return {
        action:
          RECOVERY_ACTIONS
            .VERIFY_FINANCIAL_POSTING,

        outcome:
          RECOVERY_OUTCOMES
            .RECOVERED,

        confidence:
          'HIGH',

        reasonCode:
          'PROVIDER_CONFIRMED_SUCCESS',

        details: {
          providerTransactionId:
            evidence
              .providerTransactionId ||
            null,
        },
      };
    }

    if (
      outcome === 'FAILED'
    ) {
      return {
        action:
          RECOVERY_ACTIONS
            .RETRY_OPERATION,

        outcome:
          RECOVERY_OUTCOMES
            .RETRY_REQUIRED,

        confidence:
          'HIGH',

        reasonCode:
          'PROVIDER_CONFIRMED_FAILURE',
      };
    }

    if (
      outcome === 'PENDING'
    ) {
      return {
        action:
          RECOVERY_ACTIONS
            .RETRY_PROVIDER_STATUS,

        outcome:
          RECOVERY_OUTCOMES
            .RETRY_REQUIRED,

        confidence:
          'HIGH',

        reasonCode:
          'PROVIDER_CONFIRMED_PENDING',
      };
    }

    return {
      action:
        RECOVERY_ACTIONS
          .OPEN_RECONCILIATION,

      outcome:
        RECOVERY_OUTCOMES
          .RECONCILIATION_REQUIRED,

      confidence:
        'HIGH',

      reasonCode:
        RECOVERY_REASON_CODES
          .UNKNOWN_OUTCOME,
    };
  }

  _evaluateFinancialEvidence(
    transaction,
    evidence,
    context,
  ) {
    const posted =
      evidence.posted === true ||
      [
        'POSTED',
        'COMPLETED',
        'SUCCESSFUL',
      ].includes(
        normalizeStatus(
          evidence.status,
        ),
      );

    const unknown =
      evidence.unknownOutcome === true ||
      normalizeStatus(
        evidence.status,
      ) === 'UNKNOWN';

    if (posted) {
      return {
        action:
          RECOVERY_ACTIONS
            .MARK_RECOVERED,

        outcome:
          RECOVERY_OUTCOMES
            .RECOVERED,

        confidence:
          'HIGH',

        reasonCode:
          'FINANCIAL_POSTING_CONFIRMED',
      };
    }

    if (unknown) {
      return {
        action:
          RECOVERY_ACTIONS
            .OPEN_RECONCILIATION,

        outcome:
          RECOVERY_OUTCOMES
            .RECONCILIATION_REQUIRED,

        confidence:
          'HIGH',

        reasonCode:
          RECOVERY_REASON_CODES
            .FINANCIAL_POSTING_UNKNOWN,
      };
    }

    return {
      action:
        RECOVERY_ACTIONS
          .VERIFY_FINANCIAL_POSTING,

      outcome:
        RECOVERY_OUTCOMES
          .RETRY_REQUIRED,

      confidence:
        'MEDIUM',

      reasonCode:
        RECOVERY_REASON_CODES
          .FINANCIAL_POSTING_FAILED,
    };
  }

  _evaluateFailedTransaction(
    transaction,
    reasonCode,
    context,
  ) {
    /**
     * Failed does not automatically mean safe to retry.
     *
     * If an external provider reference exists, verify first.
     */
    if (
      transaction.providerTransactionId
    ) {
      return {
        action:
          RECOVERY_ACTIONS
            .RETRY_PROVIDER_STATUS,

        outcome:
          RECOVERY_OUTCOMES
            .RETRY_REQUIRED,

        confidence:
          'HIGH',

        reasonCode:
          reasonCode ||
          RECOVERY_REASON_CODES
            .UNKNOWN_OUTCOME,
      };
    }

    return {
      action:
        RECOVERY_ACTIONS
          .RETRY_OPERATION,

      outcome:
        RECOVERY_OUTCOMES
          .RETRY_REQUIRED,

      confidence:
        'MEDIUM',

      reasonCode:
        reasonCode ||
        RECOVERY_REASON_CODES
          .PROVIDER_UNAVAILABLE,
    };
  }

  /* ==========================================================================
   * Recovery Action Execution
   * ======================================================================== */

  async _executeRecoveryAction(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    switch (
      evaluation.action
    ) {
      case RECOVERY_ACTIONS
        .NO_ACTION:
        return this._executeNoAction(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .RETRY_PROVIDER_STATUS:
        return this._executeProviderStatusRecovery(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .RETRY_OPERATION:
        return this._executeOperationRetry(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .VERIFY_FINANCIAL_POSTING:
        return this._executeFinancialRecovery(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .CREATE_REVERSAL:
        return this._executeCompensation(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .CREATE_ADJUSTMENT:
        return this._executeAdjustment(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .OPEN_RECONCILIATION:
        return this._executeReconciliation(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .RELEASE_STALE_LEASE:
        return this._executeLeaseRelease(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .MARK_RECOVERED:
        return this._executeMarkRecovered(
          transaction,
          recovery,
          evaluation,
          context,
        );

      case RECOVERY_ACTIONS
        .BLOCK_OPERATION:
        return this._executeBlock(
          transaction,
          recovery,
          evaluation,
          context,
        );

      default:
        throw new TransactionRecoveryError(
          'Unsupported recovery action.',
          {
            code:
              RECOVERY_ERROR_CODES
                .UNSUPPORTED_ACTION,

            statusCode:
              400,

            transactionId:
              transaction.id,

            recoveryId:
              recovery.id,

            tenantId:
              context.tenantId,
          },
        );
    }
  }

  /* ==========================================================================
   * No Action
   * ======================================================================== */

  async _executeNoAction(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    await this._transitionRecovery(
      recovery,
      RECOVERY_STATES
        .NO_ACTION_REQUIRED,
      context,
      {
        reasonCode:
          evaluation.reasonCode,
      },
    );

    await this._publishEvent(
      RECOVERY_EVENT_TYPES.NO_ACTION,
      transaction,
      recovery,
      context,
    );

    return {
      outcome:
        RECOVERY_OUTCOMES
          .NO_ACTION_REQUIRED,

      state:
        RECOVERY_STATES
          .NO_ACTION_REQUIRED,

      action:
        evaluation.action,

      reasonCode:
        evaluation.reasonCode,

      message:
        'No recovery action is required.',
    };
  }

  /* ==========================================================================
   * Provider Status Recovery
   * ======================================================================== */

  async _executeProviderStatusRecovery(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    if (
      !transaction.providerTransactionId
    ) {
      throw new TransactionRecoveryError(
        'Provider transaction reference is required for provider status recovery.',
        {
          code:
            RECOVERY_ERROR_CODES
              .PROVIDER_REFERENCE_REQUIRED,

          statusCode:
            409,

          transactionId:
            transaction.id,

          recoveryId:
            recovery.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    const evidence =
      await this._queryProviderStatus(
        transaction,
        context,
      );

    const outcome =
      this._normalizeProviderOutcome(
        evidence,
      );

    if (
      outcome === 'SUCCESS'
    ) {
      return this._handleProviderConfirmedSuccess(
        transaction,
        recovery,
        evidence,
        context,
      );
    }

    if (
      outcome === 'FAILED'
    ) {
      return {
        outcome:
          RECOVERY_OUTCOMES
            .RETRY_REQUIRED,

        state:
          RECOVERY_STATES
            .RETRY_REQUIRED,

        action:
          RECOVERY_ACTIONS
            .RETRY_OPERATION,

        reasonCode:
          'PROVIDER_CONFIRMED_FAILURE',

        providerEvidence:
          this._sanitizeProviderEvidence(
            evidence,
          ),
      };
    }

    if (
      outcome === 'PENDING'
    ) {
      return {
        outcome:
          RECOVERY_OUTCOMES
            .RETRY_REQUIRED,

        state:
          RECOVERY_STATES
            .RETRY_REQUIRED,

        action:
          RECOVERY_ACTIONS
            .RETRY_PROVIDER_STATUS,

        reasonCode:
          'PROVIDER_CONFIRMED_PENDING',

        providerEvidence:
          this._sanitizeProviderEvidence(
            evidence,
          ),

        nextAction:
          'RETRY_PROVIDER_STATUS',
      };
    }

    return this._executeReconciliation(
      transaction,
      recovery,
      {
        ...evaluation,

        reasonCode:
          RECOVERY_REASON_CODES
            .UNKNOWN_OUTCOME,

        providerEvidence:
          evidence,
      },
      context,
    );
  }

  async _queryProviderStatus(
    transaction,
    context,
  ) {
    if (
      this.providerStatusService
    ) {
      if (
        typeof this.providerStatusService
          .getTransactionStatus
          === 'function'
      ) {
        return this._withTimeout(
          () =>
            this.providerStatusService
              .getTransactionStatus(
                {
                  transactionId:
                    transaction.id,

                  provider:
                    transaction.provider,

                  providerTransactionId:
                    transaction
                      .providerTransactionId,
                },
                context,
              ),
          this.options
            .providerStatusTimeoutMs,
        );
      }

      if (
        typeof this.providerStatusService
          .getPaymentStatus
          === 'function'
      ) {
        return this._withTimeout(
          () =>
            this.providerStatusService
              .getPaymentStatus(
                {
                  transactionId:
                    transaction.id,

                  provider:
                    transaction.provider,

                  providerTransactionId:
                    transaction
                      .providerTransactionId,
                },
                context,
              ),
          this.options
            .providerStatusTimeoutMs,
        );
      }
    }

    if (
      this.providerRegistry
    ) {
      const provider =
        await this._resolveProvider(
          transaction,
          context,
        );

      if (
        typeof provider
          .getPaymentStatus ===
          'function'
      ) {
        return this._withTimeout(
          () =>
            provider.getPaymentStatus(
              {
                paymentId:
                  transaction.paymentId ||
                  transaction.id,

                transactionId:
                  transaction.id,

                providerTransactionId:
                  transaction
                    .providerTransactionId,
              },
              context,
            ),
          this.options
            .providerStatusTimeoutMs,
        );
      }

      if (
        typeof provider
          .getTransactionStatus ===
          'function'
      ) {
        return this._withTimeout(
          () =>
            provider.getTransactionStatus(
              {
                transactionId:
                  transaction.id,

                providerTransactionId:
                  transaction
                    .providerTransactionId,
              },
              context,
            ),
          this.options
            .providerStatusTimeoutMs,
        );
      }
    }

    throw new TransactionRecoveryError(
      'No provider status recovery operation is configured.',
      {
        code:
          RECOVERY_ERROR_CODES
            .PROVIDER_STATUS_UNAVAILABLE,

        statusCode:
          503,

        transactionId:
          transaction.id,

        tenantId:
          context.tenantId,

        retryable:
          true,
      },
    );
  }

  async _resolveProvider(
    transaction,
    context,
  ) {
    if (
      !this.providerRegistry
    ) {
      throw new TransactionRecoveryError(
        'Provider registry is unavailable.',
        {
          code:
            RECOVERY_ERROR_CODES
              .PROVIDER_STATUS_UNAVAILABLE,

          statusCode:
            503,

          transactionId:
            transaction.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    const providerName =
      normalizeProvider(
        transaction.provider,
      );

    if (!providerName) {
      throw new TransactionRecoveryError(
        'Transaction provider is required.',
        {
          code:
            RECOVERY_ERROR_CODES
              .PROVIDER_REFERENCE_REQUIRED,

          statusCode:
            409,

          transactionId:
            transaction.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    let provider = null;

    if (
      typeof this.providerRegistry.get ===
        'function'
    ) {
      provider =
        await this.providerRegistry.get(
          providerName,
          {
            tenantId:
              context.tenantId,

            transaction:
              clone(transaction),
          },
        );
    } else if (
      typeof this.providerRegistry.resolve ===
        'function'
    ) {
      provider =
        await this.providerRegistry.resolve(
          providerName,
          {
            tenantId:
              context.tenantId,

            transaction:
              clone(transaction),
          },
        );
    } else if (
      this.providerRegistry[
        providerName
      ]
    ) {
      provider =
        this.providerRegistry[
          providerName
        ];
    }

    if (!provider) {
      throw new TransactionRecoveryError(
        'Provider could not be resolved.',
        {
          code:
            RECOVERY_ERROR_CODES
              .PROVIDER_STATUS_UNAVAILABLE,

          statusCode:
            503,

          transactionId:
            transaction.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    return provider;
  }

  async _handleProviderConfirmedSuccess(
    transaction,
    recovery,
    evidence,
    context,
  ) {
    /**
     * The provider says SUCCESS. Do not simply mark the internal transaction
     * successful. First verify/repair financial posting.
     */
    if (
      transaction.financialTransactionId
    ) {
      const financial =
        await this._getFinancialTransaction(
          transaction.financialTransactionId,
          context,
        );

      if (
        this._isPostedFinancialTransaction(
          financial,
        )
      ) {
        return {
          outcome:
            RECOVERY_OUTCOMES
              .RECOVERED,

          state:
            RECOVERY_STATES
              .RECOVERED,

          action:
            RECOVERY_ACTIONS
              .MARK_RECOVERED,

          reasonCode:
            'PROVIDER_SUCCESS_FINANCIAL_POSTING_PRESENT',

          providerEvidence:
            this._sanitizeProviderEvidence(
              evidence,
            ),

          financial:
            this._sanitizeFinancial(
              financial,
            ),
        };
      }
    }

    return this._executeFinancialRecovery(
      transaction,
      recovery,
      {
        action:
          RECOVERY_ACTIONS
            .VERIFY_FINANCIAL_POSTING,

        outcome:
          RECOVERY_OUTCOMES
            .RETRY_REQUIRED,

        confidence:
          'HIGH',

        reasonCode:
          'PROVIDER_SUCCESS_FINANCIAL_POSTING_MISSING',

        providerEvidence:
          evidence,
      },
      context,
    );
  }

  /* ==========================================================================
   * Operation Retry
   * ======================================================================== */

  async _executeOperationRetry(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    /**
     * CRITICAL:
     * Recovery does not blindly re-execute an unknown external operation.
     *
     * If a provider transaction reference already exists, query provider
     * status first.
     */
    if (
      transaction.providerTransactionId
      &&
      this.options
        .neverDuplicateUnknownExternalOperation
    ) {
      const evidence =
        await this._queryProviderStatus(
          transaction,
          context,
        );

      const outcome =
        this._normalizeProviderOutcome(
          evidence,
        );

      if (
        outcome === 'SUCCESS'
        || outcome === 'PENDING'
      ) {
        return this._executeProviderStatusRecovery(
          transaction,
          recovery,
          {
            ...evaluation,
            providerEvidence:
              evidence,
          },
          context,
        );
      }

      if (
        outcome !== 'FAILED'
      ) {
        return this._executeReconciliation(
          transaction,
          recovery,
          {
            ...evaluation,
            providerEvidence:
              evidence,

            reasonCode:
              RECOVERY_REASON_CODES
                .UNKNOWN_OUTCOME,
          },
          context,
        );
      }
    }

    /**
     * This service intentionally does not invoke business/payment processing
     * directly because that would create a hidden circular recovery path.
     *
     * Instead, return a deterministic retry instruction for the owning
     * transaction worker/orchestrator.
     */
    await this._transitionRecovery(
      recovery,
      RECOVERY_STATES
        .RETRY_REQUIRED,
      context,
      {
        reasonCode:
          evaluation.reasonCode ||
          RECOVERY_REASON_CODES
            .PROVIDER_UNAVAILABLE,
      },
    );

    await this._publishEvent(
      RECOVERY_EVENT_TYPES
        .RETRY_REQUIRED,
      transaction,
      recovery,
      {
        ...context,
        metadata: {
          ...(context.metadata || {}),
          retryInstruction:
            'RETRY_OPERATION',
        },
      },
    );

    return {
      outcome:
        RECOVERY_OUTCOMES
          .RETRY_REQUIRED,

      state:
        RECOVERY_STATES
          .RETRY_REQUIRED,

      action:
        RECOVERY_ACTIONS
          .RETRY_OPERATION,

      reasonCode:
        evaluation.reasonCode,

      nextAction:
        'RETRY_TRANSACTION_WITH_ORIGINAL_IDEMPOTENCY_IDENTITY',

      safeToRetry:
        true,
    };
  }

  /* ==========================================================================
   * Financial Recovery
   * ======================================================================== */

  async _executeFinancialRecovery(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    if (
      !this.options
        .verifyFinancialState
    ) {
      return {
        outcome:
          RECOVERY_OUTCOMES
            .RECOVERED,

        state:
          RECOVERY_STATES
            .RECOVERED,

        action:
          RECOVERY_ACTIONS
            .MARK_RECOVERED,

        reasonCode:
          evaluation.reasonCode,
      };
    }

    const financialId =
      safeId(
        transaction.financialTransactionId ||
        evaluation.financialTransactionId ||
        evaluation
          .providerEvidence
          ?.financialTransactionId,
      );

    if (
      financialId
    ) {
      const financial =
        await this._getFinancialTransaction(
          financialId,
          context,
        );

      if (!financial) {
        return this._executeReconciliation(
          transaction,
          recovery,
          {
            ...evaluation,
            reasonCode:
              RECOVERY_REASON_CODES
                .FINANCIAL_POSTING_UNKNOWN,
          },
          context,
        );
      }

      if (
        this._isPostedFinancialTransaction(
          financial,
        )
      ) {
        return {
          outcome:
            RECOVERY_OUTCOMES
              .RECOVERED,

          state:
            RECOVERY_STATES
              .RECOVERED,

          action:
            RECOVERY_ACTIONS
              .MARK_RECOVERED,

          reasonCode:
            RECOVERY_REASON_CODES
              .FINANCIAL_POSTING_UNKNOWN,

          financial:
            this._sanitizeFinancial(
              financial,
            ),
        };
      }

      if (
        this._isUnknownFinancialTransaction(
          financial,
        )
      ) {
        return this._executeReconciliation(
          transaction,
          recovery,
          {
            ...evaluation,

            financial,

            reasonCode:
              RECOVERY_REASON_CODES
                .FINANCIAL_POSTING_UNKNOWN,
          },
          context,
        );
      }

      /**
       * A known-but-unposted financial transaction can be safely handed back
       * to the financial posting workflow using its original transaction
       * identity.
       */
      return {
        outcome:
          RECOVERY_OUTCOMES
            .RETRY_REQUIRED,

        state:
          RECOVERY_STATES
            .RETRY_REQUIRED,

        action:
          RECOVERY_ACTIONS
            .VERIFY_FINANCIAL_POSTING,

        reasonCode:
          RECOVERY_REASON_CODES
            .FINANCIAL_POSTING_FAILED,

        financial:
          this._sanitizeFinancial(
            financial,
          ),

        nextAction:
          'RESUME_FINANCIAL_POSTING',
      };
    }

    /**
     * No financial transaction exists.
     *
     * Recovery must not invent one unless a dedicated finance posting service
     * is explicitly injected.
     */
    if (
      this.financialService
      &&
      typeof this.financialService
        .recoverPosting ===
        'function'
    ) {
      try {
        const result =
          await this.financialService
            .recoverPosting(
              {
                transactionId:
                  transaction.id,

                paymentId:
                  transaction.paymentId ||
                  null,

                tenantId:
                  context.tenantId,

                amount:
                  canonicalAmount(
                    transaction.amount,
                  ),

                currency:
                  normalizeCurrency(
                    transaction.currency,
                  ),

                provider:
                  normalizeProvider(
                    transaction.provider,
                  ),

                providerTransactionId:
                  transaction
                    .providerTransactionId,

                idempotencyKey:
                  this._buildFinancialRecoveryKey(
                    transaction,
                    context,
                  ),
              },
              context,
            );

        const financial =
          this._normalizeFinancialResult(
            result,
          );

        if (
          financial.unknown
        ) {
          return this._executeReconciliation(
            transaction,
            recovery,
            {
              ...evaluation,

              reasonCode:
                RECOVERY_REASON_CODES
                  .FINANCIAL_POSTING_UNKNOWN,

              financial,
            },
            context,
          );
        }

        if (
          financial.posted
        ) {
          return {
            outcome:
              RECOVERY_OUTCOMES
                .RECOVERED,

            state:
              RECOVERY_STATES
                .RECOVERED,

            action:
              RECOVERY_ACTIONS
                .MARK_RECOVERED,

            reasonCode:
              'FINANCIAL_POSTING_RECOVERED',

            financial,
          };
        }

        return {
          outcome:
            RECOVERY_OUTCOMES
              .RETRY_REQUIRED,

          state:
            RECOVERY_STATES
              .RETRY_REQUIRED,

          action:
            RECOVERY_ACTIONS
              .VERIFY_FINANCIAL_POSTING,

          reasonCode:
            RECOVERY_REASON_CODES
              .FINANCIAL_POSTING_FAILED,

          financial,
        };
      } catch (error) {
        if (
          this._isUnknownOutcome(
            error,
          )
        ) {
          return this._executeReconciliation(
            transaction,
            recovery,
            {
              ...evaluation,

              reasonCode:
                RECOVERY_REASON_CODES
                  .FINANCIAL_POSTING_UNKNOWN,
            },
            context,
          );
        }

        throw new TransactionRecoveryError(
          'Financial posting recovery failed.',
          {
            code:
              RECOVERY_ERROR_CODES
                .FINANCIAL_POSTING_UNKNOWN,

            statusCode:
              Number(
                error?.statusCode,
              ) || 503,

            transactionId:
              transaction.id,

            recoveryId:
              recovery.id,

            tenantId:
              context.tenantId,

            retryable:
              true,

            cause:
              error,
          },
        );
      }
    }

    return this._executeReconciliation(
      transaction,
      recovery,
      {
        ...evaluation,

        reasonCode:
          RECOVERY_REASON_CODES
            .FINANCIAL_POSTING_UNKNOWN,
      },
      context,
    );
  }

  async _getFinancialTransaction(
    financialTransactionId,
    context,
  ) {
    if (
      !this.financialService
    ) {
      return null;
    }

    if (
      typeof this.financialService
        .getTransaction ===
        'function'
    ) {
      return this.financialService
        .getTransaction(
          financialTransactionId,
          context,
        );
    }

    if (
      typeof this.financialService
        .findTransaction ===
        'function'
    ) {
      return this.financialService
        .findTransaction(
          financialTransactionId,
          context,
        );
    }

    if (
      this.transactionRepository
      &&
      typeof this.transactionRepository
        .findFinancialTransaction ===
        'function'
    ) {
      return this.transactionRepository
        .findFinancialTransaction(
          financialTransactionId,
          {
            tenantId:
              context.tenantId,
          },
        );
    }

    return null;
  }

  _isPostedFinancialTransaction(
    transaction,
  ) {
    if (!transaction) {
      return false;
    }

    const status =
      normalizeStatus(
        transaction.status,
      );

    return (
      transaction.posted === true
      ||
      [
        'POSTED',
        'COMPLETED',
        'SUCCESSFUL',
      ].includes(
        status,
      )
    );
  }

  _isUnknownFinancialTransaction(
    transaction,
  ) {
    if (!transaction) {
      return false;
    }

    return (
      transaction.unknownOutcome ===
        true
      ||
      normalizeStatus(
        transaction.status,
      ) === 'UNKNOWN'
    );
  }

  _normalizeFinancialResult(
    result,
  ) {
    const plain =
      result &&
      typeof result === 'object'
        ? result
        : {};

    const status =
      normalizeStatus(
        plain.status,
      );

    const unknown =
      plain.unknownOutcome ===
        true
      ||
      status === 'UNKNOWN';

    const posted =
      !unknown &&
      (
        plain.posted === true
        ||
        [
          'POSTED',
          'COMPLETED',
          'SUCCESSFUL',
        ].includes(
          status,
        )
      );

    return {
      posted,
      unknown,

      status:
        unknown
          ? 'UNKNOWN'
          : (
              status ||
              (
                posted
                  ? 'POSTED'
                  : 'PENDING'
              )
            ),

      transactionId:
        safeId(
          plain.transactionId ||
          plain.id,
        ),

      financialTransactionId:
        safeId(
          plain.financialTransactionId ||
          plain.transactionId ||
          plain.id,
        ),

      journalId:
        safeId(
          plain.journalId,
        ),

      amount:
        canonicalAmount(
          plain.amount,
        ),

      currency:
        normalizeCurrency(
          plain.currency,
        ),
    };
  }

  _buildFinancialRecoveryKey(
    transaction,
    context,
  ) {
    return [
      'financial-recovery',
      context.tenantId,
      transaction.id,
    ].join(':');
  }

  /* ==========================================================================
   * Compensation / Reversal
   * ======================================================================== */

  async _executeCompensation(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    if (
      !this.options.allowCompensation
    ) {
      return {
        outcome:
          RECOVERY_OUTCOMES
            .BLOCKED,

        state:
          RECOVERY_STATES.BLOCKED,

        action:
          RECOVERY_ACTIONS
            .BLOCK_OPERATION,

        reasonCode:
          RECOVERY_REASON_CODES
            .MANUAL_RECOVERY,
      };
    }

    if (
      !transaction.financialTransactionId
    ) {
      return this._executeReconciliation(
        transaction,
        recovery,
        {
          ...evaluation,

          reasonCode:
            RECOVERY_REASON_CODES
              .FINANCIAL_POSTING_UNKNOWN,
        },
        context,
      );
    }

    /**
     * A reversal must be a new compensating financial event.
     */
    if (
      this.reversalService
    ) {
      try {
        let reversal = null;

        if (
          typeof this.reversalService
            .reverseTransaction ===
            'function'
        ) {
          reversal =
            await this.reversalService
              .reverseTransaction(
                {
                  transactionId:
                    transaction.id,

                  financialTransactionId:
                    transaction
                      .financialTransactionId,

                  tenantId:
                    context.tenantId,

                  amount:
                    canonicalAmount(
                      transaction.amount,
                    ),

                  currency:
                    normalizeCurrency(
                      transaction.currency,
                    ),

                  reasonCode:
                    evaluation.reasonCode ||
                    RECOVERY_REASON_CODES
                      .MANUAL_RECOVERY,

                  idempotencyKey:
                    this._buildReversalKey(
                      transaction,
                      context,
                    ),
                },
                context,
              );
        } else if (
          typeof this.reversalService
            .createReversal ===
            'function'
        ) {
          reversal =
            await this.reversalService
              .createReversal(
                {
                  transactionId:
                    transaction.id,

                  financialTransactionId:
                    transaction
                      .financialTransactionId,

                  tenantId:
                    context.tenantId,

                  reasonCode:
                    evaluation.reasonCode ||
                    RECOVERY_REASON_CODES
                      .MANUAL_RECOVERY,

                  idempotencyKey:
                    this._buildReversalKey(
                      transaction,
                      context,
                    ),
                },
                context,
              );
        } else {
          throw new TransactionRecoveryError(
            'Reversal service does not implement a supported reversal operation.',
            {
              code:
                RECOVERY_ERROR_CODES
                  .REVERSAL_FAILED,

              statusCode:
                500,

              transactionId:
                transaction.id,

              recoveryId:
                recovery.id,

              tenantId:
                context.tenantId,
            },
          );
        }

        return {
          outcome:
            RECOVERY_OUTCOMES
              .COMPENSATED,

          state:
            RECOVERY_STATES
              .COMPENSATED,

          action:
            RECOVERY_ACTIONS
              .CREATE_REVERSAL,

          reasonCode:
            RECOVERY_REASON_CODES
              .MANUAL_RECOVERY,

          reversal:
            this._sanitizeReversal(
              reversal,
            ),

          nextAction:
            'VERIFY_REVERSAL_POSTING',
        };
      } catch (error) {
        throw new TransactionRecoveryError(
          'Transaction compensation failed.',
          {
            code:
              RECOVERY_ERROR_CODES
                .REVERSAL_FAILED,

            statusCode:
              Number(
                error?.statusCode,
              ) || 503,

            transactionId:
              transaction.id,

            recoveryId:
              recovery.id,

            tenantId:
              context.tenantId,

            retryable:
              true,

            cause:
              error,
          },
        );
      }
    }

    return this._executeReconciliation(
      transaction,
      recovery,
      {
        ...evaluation,

        reasonCode:
          RECOVERY_REASON_CODES
            .RECONCILIATION_REPAIR,
      },
      context,
    );
  }

  _buildReversalKey(
    transaction,
    context,
  ) {
    return [
      'transaction-reversal',
      context.tenantId,
      transaction.id,
    ].join(':');
  }

  /* ==========================================================================
   * Adjustment
   * ======================================================================== */

  async _executeAdjustment(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    if (
      this.reversalService
      &&
      typeof this.reversalService
        .createAdjustmentEntry ===
        'function'
    ) {
      const adjustment =
        await this.reversalService
          .createAdjustmentEntry(
            {
              transactionId:
                transaction.id,

              financialTransactionId:
                transaction.financialTransactionId,

              tenantId:
                context.tenantId,

              amount:
                canonicalAmount(
                  transaction.amount,
                ),

              currency:
                normalizeCurrency(
                  transaction.currency,
                ),

              reasonCode:
                evaluation.reasonCode ||
                RECOVERY_REASON_CODES
                  .RECONCILIATION_REPAIR,

              idempotencyKey:
                [
                  'transaction-adjustment',
                  context.tenantId,
                  transaction.id,
                ].join(':'),
            },
            context,
          );

      return {
        outcome:
          RECOVERY_OUTCOMES
            .COMPENSATED,

        state:
          RECOVERY_STATES
            .COMPENSATED,

        action:
          RECOVERY_ACTIONS
            .CREATE_ADJUSTMENT,

        adjustment:
          this._sanitizeReversal(
            adjustment,
          ),

        reasonCode:
          evaluation.reasonCode,
      };
    }

    return this._executeReconciliation(
      transaction,
      recovery,
      evaluation,
      context,
    );
  }

  /* ==========================================================================
   * Reconciliation
   * ======================================================================== */

  async _executeReconciliation(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    const updated =
      await this._transitionRecovery(
        recovery,
        RECOVERY_STATES
          .RECONCILIATION_REQUIRED,
        context,
        {
          reasonCode:
            evaluation.reasonCode ||
            RECOVERY_REASON_CODES
              .UNKNOWN_OUTCOME,
        },
      );

    const reconciliation =
      await this._createReconciliationCase(
        transaction,
        updated,
        evaluation,
        context,
      );

    await this._publishEvent(
      RECOVERY_EVENT_TYPES
        .RECONCILIATION_REQUIRED,
      transaction,
      updated,
      {
        ...context,
        metadata: {
          ...(context.metadata || {}),
          reconciliationId:
            reconciliation?.id ||
            reconciliation?.caseId ||
            null,

          reasonCode:
            evaluation.reasonCode ||
            RECOVERY_REASON_CODES
              .UNKNOWN_OUTCOME,
        },
      },
    );

    return {
      outcome:
        RECOVERY_OUTCOMES
          .RECONCILIATION_REQUIRED,

      state:
        RECOVERY_STATES
          .RECONCILIATION_REQUIRED,

      action:
        RECOVERY_ACTIONS
          .OPEN_RECONCILIATION,

      reasonCode:
        evaluation.reasonCode ||
        RECOVERY_REASON_CODES
          .UNKNOWN_OUTCOME,

      reconciliation: {
        required:
          true,

        id:
          reconciliation?.id ||
          reconciliation?.caseId ||
          null,

        status:
          reconciliation?.status ||
          'PENDING',
      },

      nextAction:
        'RECONCILE_TRANSACTION',
    };
  }

  async _createReconciliationCase(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    if (
      !this.options.enableReconciliation
    ) {
      return {
        status:
          'DISABLED',
      };
    }

    if (
      !this.reconciliationService
    ) {
      if (
        this.options.strictMode
      ) {
        throw new TransactionRecoveryError(
          'Reconciliation service is required for unresolved transaction recovery.',
          {
            code:
              RECOVERY_ERROR_CODES
                .RECONCILIATION_UNAVAILABLE,

            statusCode:
              503,

            transactionId:
              transaction.id,

            recoveryId:
              recovery.id,

            tenantId:
              context.tenantId,

            reconciliationRequired:
              true,
          },
        );
      }

      return {
        status:
          'NOT_CONFIGURED',
      };
    }

    const payload = {
      sourceType:
        'TRANSACTION_RECOVERY',

      sourceId:
        transaction.id,

      transactionId:
        transaction.id,

      recoveryId:
        recovery.id,

      tenantId:
        context.tenantId,

      reasonCode:
        evaluation.reasonCode ||
        RECOVERY_REASON_CODES
          .UNKNOWN,

      provider:
        normalizeProvider(
          transaction.provider,
        ),

      providerTransactionId:
        normalizeString(
          transaction
            .providerTransactionId,
        ),

      amount:
        canonicalAmount(
          transaction.amount,
        ),

      currency:
        normalizeCurrency(
          transaction.currency,
        ),

      financialTransactionId:
        safeId(
          transaction.financialTransactionId,
        ),

      severity:
        'HIGH',

      metadata:
        this._sanitizeMetadata(
          {
            action:
              evaluation.action,

            confidence:
              evaluation.confidence,

            details:
              evaluation.details ||
              null,
          },
        ),
    };

    if (
      typeof this.reconciliationService
        .createTransactionException ===
        'function'
    ) {
      return this.reconciliationService
        .createTransactionException(
          payload,
          context,
        );
    }

    if (
      typeof this.reconciliationService
        .createException ===
        'function'
    ) {
      return this.reconciliationService
        .createException(
          payload,
          context,
        );
    }

    throw new TransactionRecoveryError(
      'Configured reconciliation service does not implement a supported transaction exception API.',
      {
        code:
          RECOVERY_ERROR_CODES
            .RECONCILIATION_UNAVAILABLE,

        statusCode:
          503,

        transactionId:
          transaction.id,

        recoveryId:
          recovery.id,

        tenantId:
          context.tenantId,

        reconciliationRequired:
          true,
      },
    );
  }

  /* ==========================================================================
   * Lease / Recovery Record
   * ======================================================================== */

  async _getOrCreateRecoveryRecord(
    transaction,
    context,
  ) {
    if (
      !this.recoveryRepository
    ) {
      if (
        this.options.strictMode
      ) {
        throw new TransactionRecoveryError(
          'Recovery repository is required.',
          {
            code:
              RECOVERY_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              503,

            transactionId:
              transaction.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return {
        id:
          createRecoveryId(),

        transactionId:
          transaction.id,

        tenantId:
          context.tenantId,

        status:
          RECOVERY_STATES
            .NOT_STARTED,

        recoveryAttempts:
          0,

        recoveryDepth:
          0,

        version:
          0,

        createdAt:
          now(),

        updatedAt:
          now(),
      };
    }

    let recovery =
      null;

    if (
      typeof this.recoveryRepository
        .findActiveByTransactionId
        === 'function'
    ) {
      recovery =
        await this.recoveryRepository
          .findActiveByTransactionId(
            transaction.id,
            {
              tenantId:
                context.tenantId,
            },
          );
    } else if (
      typeof this.recoveryRepository
        .findByTransactionId
        === 'function'
    ) {
      recovery =
        await this.recoveryRepository
          .findByTransactionId(
            transaction.id,
            {
              tenantId:
                context.tenantId,
            },
          );
    }

    if (Array.isArray(recovery)) {
      recovery =
        recovery[0] ||
        null;
    }

    if (recovery) {
      return this._normalizeRecovery(
        recovery,
      );
    }

    if (
      typeof this.recoveryRepository
        .create !== 'function'
    ) {
      throw new TransactionRecoveryError(
        'Recovery repository does not implement create().',
        {
          code:
            RECOVERY_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            500,

          transactionId:
            transaction.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    const record = {
      id:
        createRecoveryId(),

      transactionId:
        transaction.id,

      tenantId:
        context.tenantId,

      operationId:
        context.operationId,

      state:
        RECOVERY_STATES
          .NOT_STARTED,

      status:
        RECOVERY_STATES
          .NOT_STARTED,

      reasonCode:
        context.reasonCode ||
        RECOVERY_REASON_CODES.UNKNOWN,

      recoveryAttempts:
        0,

      recoveryDepth:
        0,

      version:
        0,

      leaseExpiresAt:
        null,

      recoveryAction:
        null,

      outcome:
        null,

      result:
        null,

      evaluation:
        null,

      recoveryHistory:
        [],

      createdAt:
        now(),

      updatedAt:
        now(),
    };

    try {
      const created =
        await this.recoveryRepository
          .create(
            record,
            {
              tenantId:
                context.tenantId,
            },
          );

      return this._normalizeRecovery(
        created ||
          record,
      );
    } catch (error) {
      if (
        this._isDuplicateKeyError(
          error,
        )
      ) {
        return this._getOrCreateRecoveryRecord(
          transaction,
          context,
        );
      }

      throw new TransactionRecoveryError(
        'Recovery record could not be created.',
        {
          code:
            RECOVERY_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            503,

          transactionId:
            transaction.id,

          tenantId:
            context.tenantId,

          cause:
            error,
        },
      );
    }
  }

  async _acquireRecoveryLease(
    recovery,
    context,
  ) {
    const current =
      this._normalizeRecovery(
        recovery,
      );

    const nowMs =
      Date.now();

    const leaseExpiresAt =
      current.leaseExpiresAt
        ? new Date(
            current.leaseExpiresAt,
          ).getTime()
        : 0;

    if (
      leaseExpiresAt
      > nowMs
      &&
      current.leaseOwner
      &&
      current.leaseOwner !==
        context.operationId
    ) {
      return {
        recoveredByAnotherWorker:
          true,

        owner:
          current.leaseOwner,

        leaseExpiresAt:
          current.leaseExpiresAt,
      };
    }

    const nextLease =
      new Date(
        nowMs +
          this.options
            .recoveryLeaseMs,
      );

    const updated =
      await this._updateRecovery(
        current,
        {
          leaseOwner:
            context.operationId,

          leaseExpiresAt:
            nextLease,

          recoveryAttempts:
            Number(
              current.recoveryAttempts ||
                0,
            ) + 1,

          recoveryDepth:
            Number(
              current.recoveryDepth ||
                0,
            ) + 1,

          updatedAt:
            now(),
        },
        context,
      );

    return {
      recoveredByAnotherWorker:
        false,

      recovery:
        updated,

      leaseExpiresAt:
        nextLease,
    };
  }

  async _markRecoveryStarted(
    recovery,
    transaction,
    context,
  ) {
    return this._transitionRecovery(
      recovery,
      RECOVERY_STATES.EVALUATING,
      context,
      {
        reasonCode:
          context.reasonCode ||
          RECOVERY_REASON_CODES
            .SYSTEM_RECOVERY,
      },
    );
  }

  async _persistEvaluation(
    recovery,
    evaluation,
    transaction,
    context,
  ) {
    return this._updateRecovery(
      recovery,
      {
        evaluation:
          this._sanitizeMetadata(
            evaluation,
          ),

        recoveryAction:
          evaluation.action,

        reasonCode:
          evaluation.reasonCode,

        updatedAt:
          now(),
      },
      context,
    );
  }

  async _transitionRecovery(
    recovery,
    targetState,
    context,
    options = {},
  ) {
    const current =
      this._normalizeRecovery(
        recovery,
      );

    const currentState =
      normalizeStatus(
        current.status ||
          current.state,
      );

    if (
      currentState ===
      targetState
    ) {
      return current;
    }

    const allowed =
      this._allowedRecoveryTransitions(
        currentState,
      );

    if (
      !allowed.includes(
        targetState,
      )
    ) {
      throw new TransactionRecoveryError(
        `Recovery transition ${currentState} -> ${targetState} is not permitted.`,
        {
          code:
            RECOVERY_ERROR_CODES
              .INVALID_TRANSITION,

          statusCode:
            409,

          transactionId:
            current.transactionId,

          recoveryId:
            current.id,

          tenantId:
            context.tenantId,

          details: {
            allowed,
          },
        },
      );
    }

    return this._updateRecovery(
      current,
      {
        state:
          targetState,

        status:
          targetState,

        lastTransition:
          options.reasonCode ||
          null,

        lastTransitionAt:
          now(),

        updatedAt:
          now(),

        leaseExpiresAt:
          targetState ===
            RECOVERY_STATES
              .RECOVERED
          || targetState ===
            RECOVERY_STATES
              .NO_ACTION_REQUIRED
          || targetState ===
            RECOVERY_STATES
              .COMPENSATED
          || targetState ===
            RECOVERY_STATES
              .BLOCKED
          || targetState ===
            RECOVERY_STATES
              .FAILED
            ? null
            : current.leaseExpiresAt,
      },
      context,
    );
  }

  _allowedRecoveryTransitions(
    currentState,
  ) {
    switch (
      currentState
    ) {
      case RECOVERY_STATES
        .NOT_STARTED:
        return [
          RECOVERY_STATES.EVALUATING,
          RECOVERY_STATES.FAILED,
        ];

      case RECOVERY_STATES
        .EVALUATING:
        return [
          RECOVERY_STATES.RECOVERING,
          RECOVERY_STATES.RETRY_REQUIRED,
          RECOVERY_STATES.RECONCILIATION_REQUIRED,
          RECOVERY_STATES.NO_ACTION_REQUIRED,
          RECOVERY_STATES.BLOCKED,
          RECOVERY_STATES.FAILED,
        ];

      case RECOVERY_STATES
        .RECOVERING:
        return [
          RECOVERY_STATES.RECOVERED,
          RECOVERY_STATES.RETRY_REQUIRED,
          RECOVERY_STATES.RECONCILIATION_REQUIRED,
          RECOVERY_STATES.COMPENSATION_REQUIRED,
          RECOVERY_STATES.COMPENSATED,
          RECOVERY_STATES.BLOCKED,
          RECOVERY_STATES.FAILED,
        ];

      case RECOVERY_STATES
        .RETRY_REQUIRED:
        return [
          RECOVERY_STATES.EVALUATING,
          RECOVERY_STATES.RECOVERING,
          RECOVERY_STATES.RECONCILIATION_REQUIRED,
          RECOVERY_STATES.FAILED,
        ];

      case RECOVERY_STATES
        .RECONCILIATION_REQUIRED:
        return [
          RECOVERY_STATES.EVALUATING,
          RECOVERY_STATES.RECOVERING,
          RECOVERY_STATES.RECOVERED,
          RECOVERY_STATES.COMPENSATION_REQUIRED,
          RECOVERY_STATES.COMPENSATED,
          RECOVERY_STATES.FAILED,
        ];

      case RECOVERY_STATES
        .COMPENSATION_REQUIRED:
        return [
          RECOVERY_STATES.RECOVERING,
          RECOVERY_STATES.COMPENSATED,
          RECOVERY_STATES.RECONCILIATION_REQUIRED,
          RECOVERY_STATES.FAILED,
        ];

      case RECOVERY_STATES
        .RECOVERED:
        return [];

      case RECOVERY_STATES
        .COMPENSATED:
        return [];

      case RECOVERY_STATES
        .NO_ACTION_REQUIRED:
        return [];

      case RECOVERY_STATES
        .BLOCKED:
        return [];

      case RECOVERY_STATES
        .FAILED:
        return [
          RECOVERY_STATES.EVALUATING,
          RECOVERY_STATES.RECOVERING,
          RECOVERY_STATES.RECONCILIATION_REQUIRED,
        ];

      default:
        return [];
    }
  }

  async _updateRecovery(
    recovery,
    patch,
    context,
  ) {
    const current =
      this._normalizeRecovery(
        recovery,
      );

    const expectedVersion =
      parseVersion(
        current.version,
      ) ?? 0;

    const nextPatch = {
      ...patch,

      version:
        expectedVersion + 1,

      updatedAt:
        now(),
    };

    if (
      this.options
        .retainRecoveryHistory
    ) {
      const historyEntry = {
        timestamp:
          isoNow(),

        fromState:
          current.status ||
          current.state,

        toState:
          nextPatch.status ||
          nextPatch.state ||
          current.status ||
          current.state,

        reasonCode:
          nextPatch.lastTransition ||
          nextPatch.reasonCode ||
          null,

        operationId:
          context.operationId ||
          null,

        actorId:
          context.actorId ||
          null,
      };

      nextPatch.recoveryHistory =
        [
          ...(current.recoveryHistory ||
            []),
          historyEntry,
        ].slice(
          -100,
        );
    }

    if (
      this.recoveryRepository
      &&
      typeof this.recoveryRepository
        .updateWithVersion ===
        'function'
    ) {
      const updated =
        await this.recoveryRepository
          .updateWithVersion(
            current.id,
            expectedVersion,
            nextPatch,
            {
              tenantId:
                context.tenantId,
            },
          );

      if (!updated) {
        throw new TransactionRecoveryError(
          'Recovery record was modified concurrently.',
          {
            code:
              RECOVERY_ERROR_CODES
                .CONCURRENT_UPDATE,

            statusCode:
              409,

            transactionId:
              current.transactionId,

            recoveryId:
              current.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return this._normalizeRecovery(
        updated,
      );
    }

    if (
      this.recoveryRepository
      &&
      typeof this.recoveryRepository
        .update ===
        'function'
    ) {
      if (
        this.options.strictMode
      ) {
        throw new TransactionRecoveryError(
          'Atomic versioned recovery updates are required in strict mode.',
          {
            code:
              RECOVERY_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              500,

            transactionId:
              current.transactionId,

            recoveryId:
              current.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      const updated =
        await this.recoveryRepository
          .update(
            current.id,
            nextPatch,
            {
              tenantId:
                context.tenantId,
            },
          );

      return this._normalizeRecovery(
        updated ||
          {
            ...current,
            ...nextPatch,
          },
      );
    }

    if (
      this.options.strictMode
    ) {
      throw new TransactionRecoveryError(
        'Recovery repository does not support atomic updates.',
        {
          code:
            RECOVERY_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            500,

          transactionId:
            current.transactionId,

          recoveryId:
            current.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    return this._normalizeRecovery({
      ...current,
      ...nextPatch,
    });
  }

  /* ==========================================================================
   * Recovery Completion / Failure
   * ======================================================================== */

  async _completeRecovery(
    recovery,
    transaction,
    result,
    context,
  ) {
    const current =
      this._normalizeRecovery(
        recovery,
      );

    const targetState =
      this._stateForOutcome(
        result.outcome,
      );

    const transitioned =
      await this._transitionRecovery(
        current,
        targetState,
        context,
        {
          reasonCode:
            result.reasonCode ||
            RECOVERY_REASON_CODES
              .SYSTEM_RECOVERY,
        },
      );

    const completed =
      await this._updateRecovery(
        transitioned,
        {
          outcome:
            result.outcome,

          result:
            this._sanitizeMetadata(
              result,
            ),

          completedAt:
            now(),

          leaseOwner:
            null,

          leaseExpiresAt:
            null,

          updatedAt:
            now(),
        },
        context,
      );

    const eventType =
      this._eventTypeForOutcome(
        result.outcome,
      );

    if (eventType) {
      await this._publishEvent(
        eventType,
        transaction,
        completed,
        {
          ...context,
          metadata: {
            ...(context.metadata || {}),
            recoveryOutcome:
              result.outcome,
          },
        },
      );
    }

    this._metric(
      'transaction_recovery_completed_total',
      1,
      {
        outcome:
          result.outcome,
      },
    );

    return completed;
  }

  async _handleRecoveryFailure(
    transaction,
    recovery,
    idempotency,
    error,
    context,
  ) {
    if (
      this._isUnknownOutcome(
        error,
      )
    ) {
      const result =
        await this._executeReconciliation(
          transaction,
          recovery,
          {
            action:
              RECOVERY_ACTIONS
                .OPEN_RECONCILIATION,

            reasonCode:
              RECOVERY_REASON_CODES
                .UNKNOWN_OUTCOME,

            outcome:
              RECOVERY_OUTCOMES
                .RECONCILIATION_REQUIRED,
          },
          context,
        );

      if (
        this.idempotencyService
      ) {
        await this.idempotencyService
          .markUnknown(
            idempotency.operationId,
            {
              reasonCode:
                RECOVERY_REASON_CODES
                  .UNKNOWN_OUTCOME,
            },
          );
      }

      return {
        result,
      };
    }

    try {
      const failed =
        await this._transitionRecovery(
          recovery,
          RECOVERY_STATES.FAILED,
          context,
          {
            reasonCode:
              error?.code ||
              RECOVERY_REASON_CODES
                .UNKNOWN,
          },
        );

      await this._updateRecovery(
        failed,
        {
          outcome:
            RECOVERY_OUTCOMES.FAILED,

          error:
            this._sanitizeError(
              error,
            ),

          completedAt:
            null,

          leaseOwner:
            null,

          leaseExpiresAt:
            null,
        },
        context,
      );

      await this._publishEvent(
        RECOVERY_EVENT_TYPES.FAILED,
        transaction,
        failed,
        context,
      );
    } catch (secondaryError) {
      this._logError(
        'Failed to persist transaction recovery failure state.',
        secondaryError,
        {
          transactionId:
            transaction.id,

          recoveryId:
            recovery.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      this.idempotencyService
    ) {
      await this.idempotencyService
        .fail(
          idempotency.operationId,
          error,
          {
            paymentId:
              transaction.id,

            reasonCode:
              error?.code ||
              RECOVERY_REASON_CODES
                .UNKNOWN,

            retryable:
              error?.retryable === true,
          },
        );
    }

    return null;
  }

  async _completeIdempotency(
    idempotency,
    result,
    transaction,
    context,
  ) {
    if (
      !this.idempotencyService
      || !idempotency?.operationId
    ) {
      return null;
    }

    return this.idempotencyService
      .complete(
        idempotency.operationId,
        {
          success:
            [
              RECOVERY_OUTCOMES.RECOVERED,
              RECOVERY_OUTCOMES.ALREADY_RECOVERED,
              RECOVERY_OUTCOMES.COMPENSATED,
              RECOVERY_OUTCOMES.NO_ACTION_REQUIRED,
            ].includes(
              result.outcome,
            ),

          outcome:
            result.outcome,

          transactionId:
            transaction.id,

          recoveryId:
            idempotency.recoveryId ||
            null,

          reasonCode:
            result.reasonCode ||
            null,

          result:
            this._sanitizeMetadata(
              result,
            ),
        },
        {
          paymentId:
            transaction.paymentId ||
            null,

          paymentReference:
            transaction.paymentReference ||
            null,

          provider:
            transaction.provider ||
            null,

          providerTransactionId:
            transaction.providerTransactionId ||
            null,
        },
      );
  }

  /* ==========================================================================
   * Lease Release
   * ======================================================================== */

  async _executeLeaseRelease(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    const updated =
      await this._updateRecovery(
        recovery,
        {
          leaseOwner:
            null,

          leaseExpiresAt:
            null,

          status:
            RECOVERY_STATES
              .RECOVERING,

          state:
            RECOVERY_STATES
              .RECOVERING,
        },
        context,
      );

    return {
      outcome:
        RECOVERY_OUTCOMES
          .RECOVERED,

      state:
        RECOVERY_STATES
          .RECOVERED,

      action:
        RECOVERY_ACTIONS
          .RELEASE_STALE_LEASE,

      reasonCode:
        evaluation.reasonCode,

      recovery:
        updated,
    };
  }

  /* ==========================================================================
   * Mark Recovered
   * ======================================================================== */

  async _executeMarkRecovered(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    return {
      outcome:
        RECOVERY_OUTCOMES
          .RECOVERED,

      state:
        RECOVERY_STATES
          .RECOVERED,

      action:
        RECOVERY_ACTIONS
          .MARK_RECOVERED,

      reasonCode:
        evaluation.reasonCode ||
        RECOVERY_REASON_CODES
          .SYSTEM_RECOVERY,

      nextAction:
        'NO_FURTHER_AUTOMATIC_RECOVERY',
    };
  }

  /* ==========================================================================
   * Block
   * ======================================================================== */

  async _executeBlock(
    transaction,
    recovery,
    evaluation,
    context,
  ) {
    return {
      outcome:
        RECOVERY_OUTCOMES
          .BLOCKED,

      state:
        RECOVERY_STATES
          .BLOCKED,

      action:
        RECOVERY_ACTIONS
          .BLOCK_OPERATION,

      reasonCode:
        evaluation.reasonCode ||
        RECOVERY_REASON_CODES
          .MANUAL_RECOVERY,

      nextAction:
        'MANUAL_REVIEW',
    };
  }

  /* ==========================================================================
   * Transaction Persistence
   * ======================================================================== */

  async _loadTransaction(
    transactionOrId,
    context,
  ) {
    if (
      transactionOrId &&
      typeof transactionOrId ===
        'object'
    ) {
      return this._normalizeTransaction(
        transactionOrId,
      );
    }

    const transactionId =
      safeId(
        transactionOrId,
      );

    if (!transactionId) {
      throw new TransactionRecoveryError(
        'Transaction ID is required.',
        {
          code:
            RECOVERY_ERROR_CODES
              .TRANSACTION_ID_REQUIRED,

          statusCode:
            400,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      !this.transactionRepository
    ) {
      throw new TransactionRecoveryError(
        'Transaction repository is unavailable.',
        {
          code:
            RECOVERY_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            503,

          transactionId,

          tenantId:
            context.tenantId,
        },
      );
    }

    let transaction = null;

    if (
      typeof this.transactionRepository
        .getById ===
        'function'
    ) {
      transaction =
        await this.transactionRepository
          .getById(
            transactionId,
            {
              tenantId:
                context.tenantId,
            },
          );
    } else if (
      typeof this.transactionRepository
        .findById ===
        'function'
    ) {
      transaction =
        await this.transactionRepository
          .findById(
            transactionId,
            {
              tenantId:
                context.tenantId,
            },
          );
    }

    if (!transaction) {
      throw new TransactionRecoveryError(
        'Transaction was not found.',
        {
          code:
            RECOVERY_ERROR_CODES
              .TRANSACTION_NOT_FOUND,

          statusCode:
            404,

          transactionId,

          tenantId:
            context.tenantId,
        },
      );
    }

    return this._normalizeTransaction(
      transaction,
    );
  }

  async _validateTransactionTenant(
    transaction,
    context,
  ) {
    if (
      this.options.requireTenant
      && !context.tenantId
    ) {
      throw new TransactionRecoveryError(
        'Tenant context is required.',
        {
          code:
            RECOVERY_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,

          transactionId:
            transaction.id,
        },
      );
    }

    if (
      transaction.tenantId
      && context.tenantId
      && transaction.tenantId !==
        context.tenantId
    ) {
      throw new TransactionRecoveryError(
        'Transaction does not belong to the current tenant.',
        {
          code:
            RECOVERY_ERROR_CODES
              .TENANT_MISMATCH,

          statusCode:
            403,

          transactionId:
            transaction.id,

          tenantId:
            context.tenantId,
        },
      );
    }
  }

  /* ==========================================================================
   * Idempotency
   * ======================================================================== */

  async _reserveRecoveryIdempotency(
    transaction,
    context,
  ) {
    if (
      !this.idempotencyService
    ) {
      if (
        this.options.strictMode
      ) {
        throw new TransactionRecoveryError(
          'Idempotency service is required for transaction recovery.',
          {
            code:
              RECOVERY_ERROR_CODES
                .IDEMPOTENCY_REQUIRED,

            statusCode:
              500,

            transactionId:
              transaction.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return {
        operationId:
          context.operationId,

        completed:
          false,
      };
    }

    const key =
      context.idempotencyKey ||
      [
        'transaction-recovery',
        transaction.id,
      ].join(':');

    let operationType =
      'TRANSACTION_RECOVERY';

    try {
      const types =
        this.idempotencyService
          .constructor
          ?.OPERATION_TYPES;

      if (
        types?.RECONCILIATION_REPAIR
      ) {
        operationType =
          types.RECONCILIATION_REPAIR;
      }
    } catch (_error) {
      // Keep default.
    }

    const result =
      await this.idempotencyService
        .reserve({
          tenantId:
            context.tenantId,

          operationType,

          key,

          operationId:
            context.operationId,

          request: {
            transactionId:
              transaction.id,

            paymentId:
              transaction.paymentId ||
              null,

            status:
              transaction.status ||
              transaction.state ||
              null,

            provider:
              transaction.provider ||
              null,

            providerTransactionId:
              transaction
                .providerTransactionId ||
              null,

            financialTransactionId:
              transaction
                .financialTransactionId ||
              null,
          },

          paymentId:
            transaction.paymentId ||
            transaction.id,

          paymentReference:
            transaction.paymentReference ||
            null,

          provider:
            transaction.provider ||
            null,

          providerTransactionId:
            transaction.providerTransactionId ||
            null,

          metadata:
            this._sanitizeMetadata(
              context.metadata,
            ),
        });

    return {
      ...result,

      operationId:
        result.operationId,

      completed:
        result.status ===
        'COMPLETED',

      result:
        result.result ||
        null,
    };
  }

  /* ==========================================================================
   * Replay
   * ======================================================================== */

  _buildReplayResult(
    transaction,
    idempotency,
    context,
  ) {
    const result =
      idempotency.result ||
      {};

    return this._buildResult(
      transaction,
      null,
      context,
      {
        ...result,

        outcome:
          result.outcome ||
          RECOVERY_OUTCOMES
            .ALREADY_RECOVERED,

        replay:
          true,
      },
    );
  }

  /* ==========================================================================
   * Events
   * ======================================================================== */

  async _publishEvent(
    eventType,
    transaction,
    recovery,
    context,
  ) {
    if (
      !this.options.publishEvents
      || !this.eventPublisher
    ) {
      return null;
    }

    const event = {
      eventId:
        `evt_recovery_${crypto.randomUUID()}`,

      eventType,

      eventVersion:
        1,

      occurredAt:
        isoNow(),

      tenantId:
        context.tenantId,

      aggregateType:
        'Transaction',

      aggregateId:
        transaction.id,

      aggregateVersion:
        parseVersion(
          transaction.version,
        ) ?? 0,

      correlationId:
        context.correlationId ||
        null,

      causationId:
        context.causationId ||
        null,

      requestId:
        context.requestId ||
        null,

      operationId:
        context.operationId ||
        null,

      source:
        'TransactionRecoveryService',

      data: {
        transactionId:
          transaction.id,

        paymentId:
          transaction.paymentId ||
          null,

        recoveryId:
          recovery?.id ||
          null,

        recoveryState:
          recovery?.status ||
          recovery?.state ||
          null,

        recoveryOutcome:
          recovery?.outcome ||
          null,

        reasonCode:
          recovery?.reasonCode ||
          null,

        provider:
          normalizeProvider(
            transaction.provider,
          ),

        providerTransactionId:
          normalizeString(
            transaction
              .providerTransactionId,
          ),

        amount:
          canonicalAmount(
            transaction.amount,
          ),

        currency:
          normalizeCurrency(
            transaction.currency,
          ),
      },

      metadata:
        this._sanitizeMetadata(
          context.metadata,
        ),
    };

    event.eventFingerprint =
      sha256(
        {
          eventType,
          tenantId:
            event.tenantId,

          aggregateId:
            event.aggregateId,

          aggregateVersion:
            event.aggregateVersion,

          recoveryId:
            recovery?.id ||
            null,
        },
      );

    try {
      if (
        typeof this.eventPublisher
          .publish ===
        'function'
      ) {
        return this.eventPublisher.publish(
          event,
        );
      }

      if (
        typeof this.eventPublisher
          .publishEvent ===
        'function'
      ) {
        return this.eventPublisher
          .publishEvent(
            event,
          );
      }

      if (
        typeof this.eventPublisher
          .emit ===
        'function'
      ) {
        return this.eventPublisher.emit(
          eventType,
          event,
        );
      }

      if (
        this.options
          .failOnEventPublicationError
      ) {
        throw new TransactionRecoveryError(
          'Recovery event publisher does not implement a supported publication API.',
          {
            code:
              RECOVERY_ERROR_CODES
                .EVENT_PUBLISH_FAILED,

            statusCode:
              503,

            transactionId:
              transaction.id,

            recoveryId:
              recovery?.id ||
              null,

            tenantId:
              context.tenantId,
          },
        );
      }
    } catch (error) {
      this._logError(
        'Transaction recovery event publication failed.',
        error,
        {
          transactionId:
            transaction.id,

          recoveryId:
            recovery?.id ||
            null,

          eventType,
        },
      );

      if (
        this.options
          .failOnEventPublicationError
      ) {
        throw error instanceof
          TransactionRecoveryError
          ? error
          : new TransactionRecoveryError(
              'Transaction recovery event publication failed.',
              {
                code:
                  RECOVERY_ERROR_CODES
                    .EVENT_PUBLISH_FAILED,

                statusCode:
                  503,

                transactionId:
                  transaction.id,

                recoveryId:
                  recovery?.id ||
                  null,

                tenantId:
                  context.tenantId,

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

  _eventTypeForOutcome(
    outcome,
  ) {
    switch (
      outcome
    ) {
      case RECOVERY_OUTCOMES
        .RECOVERED:
      case RECOVERY_OUTCOMES
        .ALREADY_RECOVERED:
        return RECOVERY_EVENT_TYPES
          .RECOVERED;

      case RECOVERY_OUTCOMES
        .RETRY_REQUIRED:
        return RECOVERY_EVENT_TYPES
          .RETRY_REQUIRED;

      case RECOVERY_OUTCOMES
        .RECONCILIATION_REQUIRED:
        return RECOVERY_EVENT_TYPES
          .RECONCILIATION_REQUIRED;

      case RECOVERY_OUTCOMES
        .COMPENSATION_REQUIRED:
        return RECOVERY_EVENT_TYPES
          .COMPENSATION_REQUIRED;

      case RECOVERY_OUTCOMES
        .COMPENSATED:
        return RECOVERY_EVENT_TYPES
          .COMPENSATED;

      case RECOVERY_OUTCOMES
        .BLOCKED:
        return RECOVERY_EVENT_TYPES
          .BLOCKED;

      case RECOVERY_OUTCOMES
        .FAILED:
        return RECOVERY_EVENT_TYPES
          .FAILED;

      case RECOVERY_OUTCOMES
        .NO_ACTION_REQUIRED:
        return RECOVERY_EVENT_TYPES
          .NO_ACTION;

      default:
        return null;
    }
  }

  /* ==========================================================================
   * Transaction Helpers
   * ======================================================================== */

  _normalizeTransaction(
    transaction,
  ) {
    if (
      !transaction
      || typeof transaction !==
        'object'
    ) {
      throw new TransactionRecoveryError(
        'Invalid transaction object.',
        {
          code:
            RECOVERY_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,
        },
      );
    }

    const plain =
      typeof transaction.toObject ===
        'function'
        ? transaction.toObject()
        : transaction;

    const id =
      safeId(
        plain.id ||
        plain._id,
      );

    if (!id) {
      throw new TransactionRecoveryError(
        'Transaction ID is required.',
        {
          code:
            RECOVERY_ERROR_CODES
              .TRANSACTION_ID_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    return {
      ...clone(plain),

      id,

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      paymentId:
        safeId(
          plain.paymentId,
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

      status:
        normalizeStatus(
          plain.status ||
          plain.state,
        ),

      state:
        normalizeStatus(
          plain.state ||
          plain.status,
        ),

      amount:
        canonicalAmount(
          plain.amount,
        ),

      currency:
        normalizeCurrency(
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

      paymentReference:
        normalizeString(
          plain.paymentReference ||
          plain.reference,
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

  _normalizeRecovery(
    recovery,
  ) {
    const plain =
      recovery &&
      typeof recovery ===
        'object'
        ? recovery
        : {};

    return {
      ...clone(plain),

      id:
        safeId(
          plain.id ||
          plain._id,
        ) ||
        createRecoveryId(),

      transactionId:
        safeId(
          plain.transactionId,
        ),

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      state:
        normalizeStatus(
          plain.state ||
          plain.status,
        ) ||
        RECOVERY_STATES
          .NOT_STARTED,

      status:
        normalizeStatus(
          plain.status ||
          plain.state,
        ) ||
        RECOVERY_STATES
          .NOT_STARTED,

      reasonCode:
        normalizeString(
          plain.reasonCode,
        ),

      recoveryAttempts:
        Number(
          plain.recoveryAttempts ||
          0,
        ),

      recoveryDepth:
        Number(
          plain.recoveryDepth ||
          0,
        ),

      version:
        parseVersion(
          plain.version,
        ) ??
        0,

      leaseOwner:
        normalizeString(
          plain.leaseOwner,
        ),

      leaseExpiresAt:
        plain.leaseExpiresAt ||
        null,

      recoveryAction:
        normalizeString(
          plain.recoveryAction,
        ),

      outcome:
        normalizeString(
          plain.outcome,
        ),

      result:
        clone(
          plain.result,
        ),

      evaluation:
        clone(
          plain.evaluation,
        ),

      recoveryHistory:
        Array.isArray(
          plain.recoveryHistory,
        )
          ? [
              ...plain.recoveryHistory,
            ]
          : [],
    };
  }

  _isSuccessfulTransaction(
    transaction,
  ) {
    return [
      'SUCCESSFUL',
      'COMPLETED',
      'POSTED',
      'SETTLED',
    ].includes(
      normalizeStatus(
        transaction.status ||
          transaction.state,
      ),
    );
  }

  _stateForOutcome(
    outcome,
  ) {
    switch (
      outcome
    ) {
      case RECOVERY_OUTCOMES
        .RECOVERED:
      case RECOVERY_OUTCOMES
        .ALREADY_RECOVERED:
        return RECOVERY_STATES
          .RECOVERED;

      case RECOVERY_OUTCOMES
        .RETRY_REQUIRED:
        return RECOVERY_STATES
          .RETRY_REQUIRED;

      case RECOVERY_OUTCOMES
        .RECONCILIATION_REQUIRED:
        return RECOVERY_STATES
          .RECONCILIATION_REQUIRED;

      case RECOVERY_OUTCOMES
        .COMPENSATION_REQUIRED:
        return RECOVERY_STATES
          .COMPENSATION_REQUIRED;

      case RECOVERY_OUTCOMES
        .COMPENSATED:
        return RECOVERY_STATES
          .COMPENSATED;

      case RECOVERY_OUTCOMES
        .NO_ACTION_REQUIRED:
        return RECOVERY_STATES
          .NO_ACTION_REQUIRED;

      case RECOVERY_OUTCOMES
        .BLOCKED:
        return RECOVERY_STATES
          .BLOCKED;

      default:
        return RECOVERY_STATES
          .FAILED;
    }
  }

  /* ==========================================================================
   * Provider Helpers
   * ======================================================================== */

  _normalizeProviderOutcome(
    evidence,
  ) {
    const status =
      normalizeStatus(
        evidence?.outcome ||
        evidence?.status ||
        evidence?.providerStatus,
      );

    if (
      [
        'SUCCESS',
        'SUCCESSFUL',
        'COMPLETED',
        'PAID',
        'APPROVED',
      ].includes(
        status,
      )
    ) {
      return 'SUCCESS';
    }

    if (
      [
        'FAILED',
        'FAILURE',
        'DECLINED',
        'REJECTED',
        'ERROR',
      ].includes(
        status,
      )
    ) {
      return 'FAILED';
    }

    if (
      [
        'PENDING',
        'PROCESSING',
        'IN_PROGRESS',
        'QUEUED',
        'INITIATED',
      ].includes(
        status,
      )
    ) {
      return 'PENDING';
    }

    if (
      [
        'CANCELLED',
        'CANCELED',
      ].includes(
        status,
      )
    ) {
      return 'CANCELLED';
    }

    if (
      [
        'REVERSED',
        'REVERSAL',
      ].includes(
        status,
      )
    ) {
      return 'REVERSED';
    }

    return 'UNKNOWN';
  }

  _sanitizeProviderEvidence(
    evidence,
  ) {
    if (!evidence) {
      return null;
    }

    return {
      provider:
        normalizeProvider(
          evidence.provider,
        ),

      providerTransactionId:
        normalizeString(
          evidence.providerTransactionId,
        ),

      providerEventId:
        normalizeString(
          evidence.providerEventId,
        ),

      status:
        normalizeStatus(
          evidence.status ||
          evidence.providerStatus,
        ),

      outcome:
        normalizeStatus(
          evidence.outcome,
        ),

      amount:
        canonicalAmount(
          evidence.amount,
        ),

      currency:
        normalizeCurrency(
          evidence.currency,
        ),

      occurredAt:
        evidence.occurredAt ||
        evidence.timestamp ||
        null,
    };
  }

  _sanitizeFinancial(
    financial,
  ) {
    if (!financial) {
      return null;
    }

    return {
      transactionId:
        safeId(
          financial.transactionId ||
          financial.id,
        ),

      financialTransactionId:
        safeId(
          financial.financialTransactionId ||
          financial.transactionId ||
          financial.id,
        ),

      journalId:
        safeId(
          financial.journalId,
        ),

      status:
        normalizeStatus(
          financial.status,
        ),

      posted:
        financial.posted === true,

      amount:
        canonicalAmount(
          financial.amount,
        ),

      currency:
        normalizeCurrency(
          financial.currency,
        ),
    };
  }

  _sanitizeReversal(
    reversal,
  ) {
    if (!reversal) {
      return null;
    }

    return {
      id:
        safeId(
          reversal.id ||
          reversal._id,
        ),

      transactionId:
        safeId(
          reversal.transactionId,
        ),

      reversalTransactionId:
        safeId(
          reversal.reversalTransactionId,
        ),

      financialTransactionId:
        safeId(
          reversal.financialTransactionId,
        ),

      status:
        normalizeStatus(
          reversal.status,
        ),

      amount:
        canonicalAmount(
          reversal.amount,
        ),

      currency:
        normalizeCurrency(
          reversal.currency,
        ),
    };
  }

  _sanitizeError(
    error,
  ) {
    if (!error) {
      return null;
    }

    return {
      code:
        normalizeString(
          error.code,
        ),

      message:
        String(
          error.message ||
            'Recovery failed.',
        ).slice(
          0,
          500,
        ),

      retryable:
        error.retryable === true,

      unknownOutcome:
        error.unknownOutcome ===
        true,
    };
  }

  /* ==========================================================================
   * Generic Helpers
   * ======================================================================== */

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
        ) ||
        'SYSTEM',

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

      reasonCode:
        normalizeString(
          context?.reasonCode,
        ),

      recoveryAction:
        normalizeString(
          context?.recoveryAction,
        )?.toUpperCase(),

      providerEvidence:
        context?.providerEvidence ||
        null,

      financialEvidence:
        context?.financialEvidence ||
        null,

      forceReview:
        context?.forceReview === true,

      metadata:
        this._sanitizeMetadata(
          context?.metadata ||
            {},
        ),
    };
  }

  _assertContext(
    context,
  ) {
    if (
      this.options.requireTenant
      && !context.tenantId
    ) {
      throw new TransactionRecoveryError(
        'Tenant context is required.',
        {
          code:
            RECOVERY_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,
        },
      );
    }

    if (
      this.options.requireIdempotency
      && !context.idempotencyKey
    ) {
      throw new TransactionRecoveryError(
        'Recovery idempotency key is required.',
        {
          code:
            RECOVERY_ERROR_CODES
              .IDEMPOTENCY_REQUIRED,

          statusCode:
            400,

          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _publishEventSafe(
    eventType,
    transaction,
    recovery,
    context,
  ) {
    try {
      return await this._publishEvent(
        eventType,
        transaction,
        recovery,
        context,
      );
    } catch (error) {
      if (
        this.options
          .failOnEventPublicationError
      ) {
        throw error;
      }

      return null;
    }
  }

  async _publishEvent(
    eventType,
    transaction,
    recovery,
    context,
  ) {
    if (
      !this.options.publishEvents
      || !this.eventPublisher
    ) {
      return null;
    }

    const event = {
      eventId:
        `evt_recovery_${crypto.randomUUID()}`,

      eventType,

      eventVersion:
        1,

      occurredAt:
        isoNow(),

      tenantId:
        context.tenantId,

      aggregateType:
        'Transaction',

      aggregateId:
        transaction.id,

      aggregateVersion:
        parseVersion(
          transaction.version,
        ) ??
        0,

      correlationId:
        context.correlationId ||
        null,

      causationId:
        context.causationId ||
        null,

      requestId:
        context.requestId ||
        null,

      operationId:
        context.operationId ||
        null,

      source:
        'TransactionRecoveryService',

      data: {
        transactionId:
          transaction.id,

        recoveryId:
          recovery?.id ||
          null,

        recoveryState:
          recovery?.status ||
          recovery?.state ||
          null,

        recoveryOutcome:
          recovery?.outcome ||
          null,

        reasonCode:
          recovery?.reasonCode ||
          null,

        provider:
          normalizeProvider(
            transaction.provider,
          ),

        providerTransactionId:
          normalizeString(
            transaction
              .providerTransactionId,
          ),

        amount:
          canonicalAmount(
            transaction.amount,
          ),

        currency:
          normalizeCurrency(
            transaction.currency,
          ),
      },

      metadata:
        this._sanitizeMetadata(
          context.metadata,
        ),
    };

    event.eventFingerprint =
      sha256({
        eventType,
        tenantId:
          event.tenantId,

        aggregateId:
          event.aggregateId,

        aggregateVersion:
          event.aggregateVersion,

        recoveryId:
          recovery?.id ||
          null,
      });

    try {
      if (
        typeof this.eventPublisher
          .publish ===
        'function'
      ) {
        return this.eventPublisher.publish(
          event,
        );
      }

      if (
        typeof this.eventPublisher
          .publishEvent ===
        'function'
      ) {
        return this.eventPublisher
          .publishEvent(
            event,
          );
      }

      if (
        typeof this.eventPublisher
          .emit ===
        'function'
      ) {
        return this.eventPublisher.emit(
          eventType,
          event,
        );
      }
    } catch (error) {
      this._logError(
        'Transaction recovery event publication failed.',
        error,
        {
          transactionId:
            transaction.id,

          recoveryId:
            recovery?.id ||
            null,

          eventType,
        },
      );

      if (
        this.options
          .failOnEventPublicationError
      ) {
        throw new TransactionRecoveryError(
          'Transaction recovery event publication failed.',
          {
            code:
              RECOVERY_ERROR_CODES
                .EVENT_PUBLISH_FAILED,

            statusCode:
              503,

            transactionId:
              transaction.id,

            recoveryId:
              recovery?.id ||
              null,

            tenantId:
              context.tenantId,

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

  _buildResult(
    transaction,
    recovery,
    context,
    result,
  ) {
    return {
      success:
        [
          RECOVERY_OUTCOMES.RECOVERED,
          RECOVERY_OUTCOMES.ALREADY_RECOVERED,
          RECOVERY_OUTCOMES.COMPENSATED,
          RECOVERY_OUTCOMES.NO_ACTION_REQUIRED,
        ].includes(
          result.outcome,
        ),

      outcome:
        result.outcome,

      state:
        result.state ||
        recovery?.status ||
        null,

      action:
        result.action ||
        recovery?.recoveryAction ||
        null,

      reasonCode:
        result.reasonCode ||
        recovery?.reasonCode ||
        null,

      transactionId:
        transaction.id,

      recoveryId:
        recovery?.id ||
        null,

      tenantId:
        context.tenantId,

      provider:
        normalizeProvider(
          transaction.provider,
        ),

      providerTransactionId:
        normalizeString(
          transaction
            .providerTransactionId,
        ),

      amount:
        canonicalAmount(
          transaction.amount,
        ),

      currency:
        normalizeCurrency(
          transaction.currency,
        ),

      financialTransactionId:
        safeId(
          transaction
            .financialTransactionId,
        ),

      reconciliationRequired:
        result.reconciliationRequired ===
          true
        ||
        result.outcome ===
          RECOVERY_OUTCOMES
            .RECONCILIATION_REQUIRED,

      reconciliation:
        result.reconciliation ||
        null,

      providerEvidence:
        this._sanitizeProviderEvidence(
          result.providerEvidence,
        ),

      financial:
        this._sanitizeFinancial(
          result.financial,
        ),

      reversal:
        this._sanitizeReversal(
          result.reversal,
        ),

      adjustment:
        this._sanitizeReversal(
          result.adjustment,
        ),

      retryable:
        result.outcome ===
          RECOVERY_OUTCOMES
            .RETRY_REQUIRED,

      replay:
        result.replay === true,

      nextAction:
        result.nextAction ||
        null,

      message:
        result.message ||
        null,

      operationId:
        context.operationId,

      requestId:
        context.requestId ||
        null,

      correlationId:
        context.correlationId ||
        null,

      completedAt:
        isoNow(),
    };
  }

  _buildReplayResult(
    transaction,
    idempotency,
    context,
  ) {
    return this._buildResult(
      transaction,
      null,
      context,
      {
        ...(idempotency.result || {}),
        outcome:
          idempotency.result?.outcome ||
          RECOVERY_OUTCOMES
            .ALREADY_RECOVERED,

        replay:
          true,
      },
    );
  }

  /* ==========================================================================
   * Configuration
   * ======================================================================== */

  getStates() {
    return Object.freeze({
      ...RECOVERY_STATES,
    });
  }

  getOutcomes() {
    return Object.freeze({
      ...RECOVERY_OUTCOMES,
    });
  }

  getActions() {
    return Object.freeze({
      ...RECOVERY_ACTIONS,
    });
  }

  getReasonCodes() {
    return Object.freeze({
      ...RECOVERY_REASON_CODES,
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

      protectSuccessfulTransactions:
        this.options
          .protectSuccessfulTransactions,

      prohibitHistoricalMutation:
        this.options
          .prohibitHistoricalMutation,

      requireEvidenceForUnknownResolution:
        this.options
          .requireEvidenceForUnknownResolution,

      allowProviderStatusRecovery:
        this.options
          .allowProviderStatusRecovery,

      verifyFinancialState:
        this.options
          .verifyFinancialState,

      allowCompensation:
        this.options
          .allowCompensation,

      enableReconciliation:
        this.options
          .enableReconciliation,

      publishEvents:
        this.options.publishEvents,

      maxAutomaticRecoveryAttempts:
        this.options
          .maxAutomaticRecoveryAttempts,

      maxRecoveryDepth:
        this.options.maxRecoveryDepth,

      hasTransactionRepository:
        Boolean(
          this.transactionRepository,
        ),

      hasRecoveryRepository:
        Boolean(
          this.recoveryRepository,
        ),

      hasIdempotencyService:
        Boolean(
          this.idempotencyService,
        ),

      hasFinancialService:
        Boolean(
          this.financialService,
        ),

      hasReversalService:
        Boolean(
          this.reversalService,
        ),

      hasProviderRegistry:
        Boolean(
          this.providerRegistry,
        ),

      hasProviderStatusService:
        Boolean(
          this.providerStatusService,
        ),

      hasReconciliationService:
        Boolean(
          this.reconciliationService,
        ),

      hasEventPublisher:
        Boolean(
          this.eventPublisher,
        ),
    });
  }

  validateConfiguration() {
    const errors = [];

    if (
      this.options.strictMode &&
      !this.transactionRepository
    ) {
      errors.push(
        'transactionRepository is required in strict mode.',
      );
    }

    if (
      this.options.strictMode &&
      !this.recoveryRepository
    ) {
      errors.push(
        'recoveryRepository is required in strict mode.',
      );
    }

    if (
      this.options.strictMode &&
      !this.idempotencyService
    ) {
      errors.push(
        'idempotencyService is required in strict mode.',
      );
    }

    if (
      this.options.verifyFinancialState &&
      this.options.strictMode &&
      !this.financialService
    ) {
      errors.push(
        'financialService is required for financial-state recovery.',
      );
    }

    if (
      this.options.enableReconciliation &&
      this.options.strictMode &&
      !this.reconciliationService
    ) {
      errors.push(
        'reconciliationService is required for unresolved recoveries.',
      );
    }

    if (
      this.options.publishEvents &&
      this.options
        .failOnEventPublicationError &&
      this.options.strictMode &&
      !this.eventPublisher
    ) {
      errors.push(
        'eventPublisher is required when recovery events are mandatory.',
      );
    }

    return {
      valid:
        errors.length === 0,

      errors,
    };
  }

  /* ==========================================================================
   * Generic Helpers
   * ======================================================================== */

  async _withTimeout(
    operation,
    timeoutMs,
  ) {
    if (
      !Number.isFinite(
        timeoutMs,
      ) ||
      timeoutMs <= 0
    ) {
      return operation();
    }

    let timer = null;

    const timeoutPromise =
      new Promise(
        (_resolve, reject) => {
          timer =
            setTimeout(
              () => {
                const error =
                  new Error(
                    'Transaction recovery operation timed out.',
                  );

                error.code =
                  'ETIMEDOUT';

                reject(
                  error,
                );
              },
              timeoutMs,
            );
        },
      );

    try {
      return await Promise.race([
        operation(),
        timeoutPromise,
      ]);
    } finally {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  _isUnknownOutcome(
    error,
  ) {
    if (
      error?.unknownOutcome ===
      true
    ) {
      return true;
    }

    const code =
      String(
        error?.code ||
          '',
      ).toUpperCase();

    return [
      'ETIMEDOUT',
      'ECONNRESET',
      'UNKNOWN_OUTCOME',
      'PROVIDER_OPERATION_UNKNOWN',
      'FINANCIAL_POSTING_UNKNOWN',
      'TRANSACTION_TIMEOUT',
    ].includes(
      code,
    );
  }

  _isDuplicateKeyError(
    error,
  ) {
    if (!error) {
      return false;
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
        'DUPLICATE_RECOVERY',
        'UNIQUE_CONSTRAINT',
      ].includes(
        code,
      )
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

  _sanitizeMetadata(
    metadata,
  ) {
    if (
      !metadata ||
      typeof metadata !==
        'object'
    ) {
      return {};
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
      ]);

    const sanitize =
      (value, depth = 0) => {
        if (
          depth > 8
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
          typeof value === 'string'
        ) {
          return value.length > 5000
            ? `${value.slice(
                0,
                5000,
              )}...`
            : value;
        }

        if (
          typeof value !==
            'object'
        ) {
          return value;
        }

        if (
          Array.isArray(value)
        ) {
          return value
            .slice(0, 100)
            .map(
              (item) =>
                sanitize(
                  item,
                  depth + 1,
                ),
            );
        }

        const result = {};

        for (
          const [
            key,
            child,
          ] of Object.entries(
            value,
          ).slice(0, 100)
        ) {
          if (
            sensitiveKeys.has(
              key,
            )
          ) {
            result[key] =
              '[REDACTED]';

            continue;
          }

          result[key] =
            sanitize(
              child,
              depth + 1,
            );
        }

        return result;
      };

    return sanitize(
      metadata,
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
      // Never mask the primary recovery error.
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
      // Observability failures never break financial recovery.
    }
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

TransactionRecoveryService.STATES =
  RECOVERY_STATES;

TransactionRecoveryService.OUTCOMES =
  RECOVERY_OUTCOMES;

TransactionRecoveryService.REASON_CODES =
  RECOVERY_REASON_CODES;

TransactionRecoveryService.ACTIONS =
  RECOVERY_ACTIONS;

TransactionRecoveryService.OPERATION_TYPES =
  RECOVERY_OPERATION_TYPES;

TransactionRecoveryService.EVENT_TYPES =
  RECOVERY_EVENT_TYPES;

TransactionRecoveryService.ERROR_CODES =
  RECOVERY_ERROR_CODES;

TransactionRecoveryService.TransactionRecoveryError =
  TransactionRecoveryError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createTransactionRecoveryService(
  dependencies = {},
) {
  return new TransactionRecoveryService(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  TransactionRecoveryService;

module.exports.TransactionRecoveryService =
  TransactionRecoveryService;

module.exports.TransactionRecoveryError =
  TransactionRecoveryError;

module.exports.createTransactionRecoveryService =
  createTransactionRecoveryService;

module.exports.RECOVERY_STATES =
  RECOVERY_STATES;

module.exports.RECOVERY_OUTCOMES =
  RECOVERY_OUTCOMES;

module.exports.RECOVERY_REASON_CODES =
  RECOVERY_REASON_CODES;

module.exports.RECOVERY_ACTIONS =
  RECOVERY_ACTIONS;

module.exports.RECOVERY_OPERATION_TYPES =
  RECOVERY_OPERATION_TYPES;

module.exports.RECOVERY_EVENT_TYPES =
  RECOVERY_EVENT_TYPES;

module.exports.RECOVERY_ERROR_CODES =
  RECOVERY_ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */