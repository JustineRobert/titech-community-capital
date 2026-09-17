'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Disbursement Gateway
 * ----------------------------------------------------------
 * File
 * ----
 * backend/modules/payment/mtn/disbursements.js
 *
 * Architectural Role
 * ------------------
 * Provider-adapter/orchestration boundary for outbound MTN
 * MoMo disbursements.
 *
 * Supported business operations
 * -----------------------------
 * - Loan payouts
 * - Savings withdrawals
 * - Member refunds
 * - Supplier payments
 * - Bulk transfers
 *
 * Responsibilities
 * ----------------
 * - Validate disbursement requests.
 * - Resolve and enforce tenant scope.
 * - Enforce authorization and approval controls.
 * - Validate beneficiary data.
 * - Apply configurable fraud/risk controls.
 * - Enforce idempotency.
 * - Delegate authoritative disbursement creation.
 * - Correlate provider callbacks.
 * - Register settlement tracking.
 * - Record audit evidence.
 * - Publish/outbox integration events.
 * - Support controlled compensation/recovery delegation.
 * - Provide safe operational health/diagnostics.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - OAuth implementation.
 * - Credential management.
 * - Access-token storage.
 * - Callback processing.
 * - Callback signature verification.
 * - Direct balance mutation.
 * - Direct ledger posting.
 * - Direct financial transaction mutation.
 * - Final settlement.
 * - Reconciliation implementation.
 * - Provider-specific financial accounting.
 *
 * Critical Financial Safety Rule
 * ------------------------------
 * MTN accepting a transfer request is NOT equivalent to:
 *
 *   beneficiary received funds
 *   +
 *   payment settled
 *   +
 *   ledger posted
 *
 * Final financial state must be established by the authoritative financial
 * and settlement/reconciliation services.
 *
 * Recommended lifecycle
 * ---------------------
 *
 *   Request
 *      ↓
 *   Validate
 *      ↓
 *   Authorize / Approve
 *      ↓
 *   Beneficiary / Fraud Controls
 *      ↓
 *   Idempotency
 *      ↓
 *   Internal Disbursement
 *      ↓
 *   MTN Provider Submission
 *      ↓
 *   Provider Accepted / Pending
 *      ↓
 *   Callback / Provider Status
 *      ↓
 *   Reconciliation
 *      ↓
 *   Financial Settlement
 *      ↓
 *   Final Confirmation
 *
 * Security Principles
 * -------------------
 * - Never log OAuth tokens.
 * - Never log API keys or credentials.
 * - Never log full sensitive beneficiary payloads.
 * - Never permit cross-tenant disbursement access.
 * - Never bypass approval requirements.
 * - Never use beneficiary input as a financial-accounting authority.
 * - Never classify provider acceptance as final settlement.
 * - Never perform direct balance mutation here.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ==========================================================
 */

const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_RETRY_MAX_MS = 5_000;

const DISBURSEMENT_TYPES = Object.freeze({
  LOAN_DISBURSEMENT: 'LOAN_DISBURSEMENT',
  SAVINGS_WITHDRAWAL: 'SAVINGS_WITHDRAWAL',
  MEMBER_REFUND: 'MEMBER_REFUND',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  BULK_TRANSFER: 'BULK_TRANSFER'
});

const DISBURSEMENT_STATUSES = Object.freeze({
  CREATED: 'CREATED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVED: 'APPROVED',
  SUBMITTED: 'SUBMITTED',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  PENDING_CALLBACK: 'PENDING_CALLBACK',
  PENDING_PROVIDER: 'PENDING_PROVIDER',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  SETTLED: 'SETTLED',
  DISPUTED: 'DISPUTED'
});

const PROVIDER_OUTCOMES = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN'
});

const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'MTN_DISBURSEMENT_INVALID_INPUT',
  TENANT_REQUIRED: 'MTN_DISBURSEMENT_TENANT_REQUIRED',
  BENEFICIARY_REQUIRED: 'MTN_DISBURSEMENT_BENEFICIARY_REQUIRED',
  AMOUNT_REQUIRED: 'MTN_DISBURSEMENT_AMOUNT_REQUIRED',
  INVALID_AMOUNT: 'MTN_DISBURSEMENT_INVALID_AMOUNT',
  CURRENCY_REQUIRED: 'MTN_DISBURSEMENT_CURRENCY_REQUIRED',
  INVALID_CURRENCY: 'MTN_DISBURSEMENT_INVALID_CURRENCY',
  REFERENCE_REQUIRED: 'MTN_DISBURSEMENT_REFERENCE_REQUIRED',
  TYPE_INVALID: 'MTN_DISBURSEMENT_TYPE_INVALID',
  AUTHORIZATION_DENIED: 'MTN_DISBURSEMENT_AUTHORIZATION_DENIED',
  APPROVAL_REQUIRED: 'MTN_DISBURSEMENT_APPROVAL_REQUIRED',
  BENEFICIARY_INVALID: 'MTN_DISBURSEMENT_BENEFICIARY_INVALID',
  FRAUD_REJECTED: 'MTN_DISBURSEMENT_FRAUD_REJECTED',
  IDEMPOTENCY_CONFLICT: 'MTN_DISBURSEMENT_IDEMPOTENCY_CONFLICT',
  DUPLICATE_REQUEST: 'MTN_DISBURSEMENT_DUPLICATE_REQUEST',
  PROVIDER_FAILED: 'MTN_DISBURSEMENT_PROVIDER_FAILED',
  PROVIDER_TIMEOUT: 'MTN_DISBURSEMENT_PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'MTN_DISBURSEMENT_PROVIDER_UNAVAILABLE',
  PROVIDER_RESPONSE_INVALID: 'MTN_DISBURSEMENT_PROVIDER_RESPONSE_INVALID',
  INTERNAL_CREATE_FAILED: 'MTN_DISBURSEMENT_INTERNAL_CREATE_FAILED',
  CALLBACK_CORRELATION_FAILED: 'MTN_DISBURSEMENT_CALLBACK_CORRELATION_FAILED',
  SETTLEMENT_FAILED: 'MTN_DISBURSEMENT_SETTLEMENT_FAILED',
  COMPENSATION_FAILED: 'MTN_DISBURSEMENT_COMPENSATION_FAILED',
  EVENT_FAILED: 'MTN_DISBURSEMENT_EVENT_FAILED',
  CONFIGURATION_ERROR: 'MTN_DISBURSEMENT_CONFIGURATION_ERROR',
  INTERNAL_ERROR: 'MTN_DISBURSEMENT_INTERNAL_ERROR'
});

const TRANSIENT_HTTP_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504
]);

const SECRET_KEY_PATTERN =
  /(authorization|password|passwd|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|cookie|credential)/i;

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

class MTNDisbursementError extends Error {
  constructor(
    message,
    code = ERROR_CODES.INTERNAL_ERROR,
    details = undefined,
    options = {}
  ) {
    super(message);

    this.name = 'MTNDisbursementError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.httpStatus = Number.isFinite(options.httpStatus)
      ? options.httpStatus
      : undefined;
    this.conflict = Boolean(options.conflict);
    this.rejected = Boolean(options.rejected);
    this.providerStatus = options.providerStatus;
    this.providerCode = options.providerCode;

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MTNDisbursementError);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function normalizeString(value, maxLength = 512) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function normalizeId(value) {
  return normalizeString(value, 256);
}

function createCorrelationId() {
  return `mtn-disbursement-${crypto.randomUUID()}`;
}

function createOperationId() {
  return `disbursement-${crypto.randomUUID()}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function calculateRetryDelay(
  attempt,
  baseMs,
  maxMs
) {
  const exponential =
    baseMs *
    2 **
      Math.max(
        attempt - 1,
        0
      );

  const bounded =
    Math.min(
      exponential,
      maxMs
    );

  const jitter =
    Math.floor(
      Math.random() *
        Math.max(
          1,
          bounded * 0.25
        )
    );

  return Math.min(
    maxMs,
    bounded + jitter
  );
}

function isTransientStatus(status) {
  return TRANSIENT_HTTP_STATUSES.has(
    Number(status)
  );
}

function sanitize(
  value,
  depth = 0
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    depth > 6
  ) {
    return '[TRUNCATED]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return typeof value === 'string' &&
      value.length > 512
      ? `${value.slice(
          0,
          512
        )}...[TRUNCATED]`
      : value;
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return value.map(
      (item) =>
        sanitize(
          item,
          depth + 1
        )
    );
  }

  if (
    typeof value === 'object'
  ) {
    const output = {};

    for (
      const [
        key,
        child
      ] of Object.entries(
        value
      )
    ) {
      output[key] =
        SECRET_KEY_PATTERN.test(
          key
        )
          ? '[REDACTED]'
          : sanitize(
              child,
              depth + 1
            );
    }

    return output;
  }

  return '[REDACTED]';
}

function serializeError(
  error
) {
  return sanitize({
    name:
      error?.name,
    code:
      error?.code,
    message:
      error?.message,
    retryable:
      error?.retryable,
    conflict:
      error?.conflict,
    providerStatus:
      error?.providerStatus,
    providerCode:
      error?.providerCode
  });
}

function resolveLogger(
  injected
) {
  if (injected) {
    return injected;
  }

  const candidates = [
    '../../../utils/logger',
    '../../../utils/log',
    '../../../config/logger'
  ];

  for (
    const modulePath of
      candidates
  ) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(
          modulePath
        );

      const logger =
        loaded?.default ||
        loaded;

      if (logger) {
        return logger;
      }
    } catch (
      _error
    ) {
      // Continue.
    }
  }

  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function normalizeAmount(
  amount
) {
  if (
    amount === undefined ||
    amount === null ||
    amount === ''
  ) {
    throw new MTNDisbursementError(
      'Disbursement amount is required.',
      ERROR_CODES.AMOUNT_REQUIRED,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  const value =
    String(amount).trim();

  /*
   * Keep monetary values as decimal strings. Do not perform monetary
   * arithmetic using JavaScript floating point.
   */
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(
      value
    )
  ) {
    throw new MTNDisbursementError(
      'Disbursement amount is invalid.',
      ERROR_CODES.INVALID_AMOUNT,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  if (
    /^0+(?:\.0+)?$/.test(
      value
    )
  ) {
    throw new MTNDisbursementError(
      'Disbursement amount must be greater than zero.',
      ERROR_CODES.INVALID_AMOUNT,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  return value;
}

function normalizeCurrency(
  currency
) {
  const value =
    normalizeString(
      currency ||
        DEFAULT_CURRENCY,
      16
    )?.toUpperCase();

  if (!value) {
    throw new MTNDisbursementError(
      'Disbursement currency is required.',
      ERROR_CODES.CURRENCY_REQUIRED,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  if (!/^[A-Z]{3}$/.test(value)) {
    throw new MTNDisbursementError(
      'Disbursement currency is invalid.',
      ERROR_CODES.INVALID_CURRENCY,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  return value;
}

function normalizeType(
  type
) {
  const value =
    normalizeString(
      type ||
        DISBURSEMENT_TYPES.LOAN_DISBURSEMENT,
      128
    );

  if (
    !Object.values(
      DISBURSEMENT_TYPES
    ).includes(
      value
    )
  ) {
    throw new MTNDisbursementError(
      `Unsupported disbursement type: ${value}.`,
      ERROR_CODES.TYPE_INVALID,
      {
        supported:
          Object.values(
            DISBURSEMENT_TYPES
          )
      },
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  return value;
}

function normalizeReference(
  reference
) {
  const value =
    normalizeString(
      reference,
      256
    );

  if (!value) {
    throw new MTNDisbursementError(
      'Disbursement reference is required.',
      ERROR_CODES.REFERENCE_REQUIRED,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  return value;
}

function normalizeBeneficiary(
  beneficiary
) {
  if (
    !beneficiary
  ) {
    throw new MTNDisbursementError(
      'Beneficiary is required.',
      ERROR_CODES.BENEFICIARY_REQUIRED,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  if (
    typeof beneficiary ===
    'string'
  ) {
    const value =
      normalizeString(
        beneficiary,
        128
      );

    if (!value) {
      throw new MTNDisbursementError(
        'Beneficiary is required.',
        ERROR_CODES.BENEFICIARY_REQUIRED,
        undefined,
        {
          httpStatus: 400,
          rejected: true
        }
      );
    }

    return value;
  }

  if (
    typeof beneficiary !==
    'object'
  ) {
    throw new MTNDisbursementError(
      'Beneficiary format is invalid.',
      ERROR_CODES.BENEFICIARY_INVALID,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  /*
   * Preserve structured beneficiary information but avoid retaining secrets
   * such as PIN/password/token-like properties.
   */
  const value =
    sanitize(
      beneficiary
    );

  /*
   * Phone/MSISDN may have different naming conventions in existing
   * implementations. Do not require one shape here when the beneficiary
   * service is authoritative for final validation.
   */
  return value;
}

function normalizeInput(
  input
) {
  if (
    !input ||
    typeof input !==
      'object'
  ) {
    throw new MTNDisbursementError(
      'Disbursement request is required.',
      ERROR_CODES.INVALID_INPUT,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  const tenantId =
    normalizeId(
      input.tenantId
    );

  if (!tenantId) {
    throw new MTNDisbursementError(
      'tenantId is required.',
      ERROR_CODES.TENANT_REQUIRED,
      undefined,
      {
        httpStatus: 400,
        rejected: true
      }
    );
  }

  const reference =
    normalizeReference(
      input.reference
    );

  const amount =
    normalizeAmount(
      input.amount
    );

  const currency =
    normalizeCurrency(
      input.currency
    );

  const type =
    normalizeType(
      input.type
    );

  const beneficiary =
    normalizeBeneficiary(
      input.beneficiary
    );

  const correlationId =
    normalizeId(
      input.correlationId
    ) ||
    createCorrelationId();

  const operationId =
    normalizeId(
      input.operationId
    ) ||
    createOperationId();

  const idempotencyKey =
    normalizeString(
      input.idempotencyKey,
      256
    ) ||
    `mtn-disbursement:${crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          tenantId,
          reference,
          amount,
          currency,
          type,
          beneficiary
        })
      )
      .digest('hex')}`;

  const requestFingerprint =
    crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          tenantId,
          reference,
          amount,
          currency,
          type,
          beneficiary
        })
      )
      .digest('hex');

  return {
    tenantId,
    reference,
    amount,
    currency,
    type,
    beneficiary,

    requestedBy:
      normalizeId(
        input.requestedBy
      ),

    approvedBy:
      normalizeId(
        input.approvedBy
      ),

    approvalId:
      normalizeId(
        input.approvalId
      ),

    metadata:
      sanitize(
        input.metadata ||
          {}
      ),

    idempotencyKey,
    requestFingerprint,
    correlationId,
    operationId
  };
}

/* -------------------------------------------------------------------------- */
/* Provider response                                                          */
/* -------------------------------------------------------------------------- */

function classifyProviderResponse(
  response
) {
  if (
    !response
  ) {
    return PROVIDER_OUTCOMES.UNKNOWN;
  }

  if (
    response.ok === false
  ) {
    if (
      isTransientStatus(
        response.status
      )
    ) {
      return PROVIDER_OUTCOMES.PENDING;
    }

    return PROVIDER_OUTCOMES.FAILED;
  }

  const status =
    normalizeString(
      response.data?.status ||
        response.data?.state ||
        response.statusText,
      128
    )?.toUpperCase();

  if (
    [
      'SUCCESS',
      'SUCCESSFUL',
      'ACCEPTED',
      'COMPLETED'
    ].includes(
      status
    )
  ) {
    return PROVIDER_OUTCOMES.ACCEPTED;
  }

  if (
    [
      'PENDING',
      'PROCESSING',
      'QUEUED',
      'IN_PROGRESS',
      'UNKNOWN'
    ].includes(
      status
    )
  ) {
    return PROVIDER_OUTCOMES.PENDING;
  }

  if (
    [
      'FAILED',
      'REJECTED',
      'DECLINED',
      'CANCELLED',
      'CANCELED'
    ].includes(
      status
    )
  ) {
    return PROVIDER_OUTCOMES.FAILED;
  }

  if (
    response.ok
  ) {
    return PROVIDER_OUTCOMES.ACCEPTED;
  }

  return PROVIDER_OUTCOMES.UNKNOWN;
}

function normalizeProviderResponse(
  response
) {
  if (
    !response ||
    typeof response !==
      'object'
  ) {
    throw new MTNDisbursementError(
      'MTN returned an invalid disbursement response.',
      ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      undefined,
      {
        retryable: true
      }
    );
  }

  const data =
    response.data ||
    {};

  return {
    outcome:
      classifyProviderResponse(
        response
      ),

    providerReference:
      normalizeId(
        data.referenceId ||
          data.referenceID ||
          data.transactionId ||
          data.externalId ||
          response.referenceId
      ),

    providerStatus:
      normalizeString(
        data.status ||
          data.state ||
          response.statusText,
        128
      ),

    providerCode:
      normalizeString(
        data.code ||
          data.errorCode,
        128
      ),

    httpStatus:
      Number.isFinite(
        Number(
          response.status
        )
      )
        ? Number(
            response.status
          )
        : undefined
  };
}

/* -------------------------------------------------------------------------- */
/* MTN Disbursement Gateway                                                   */
/* -------------------------------------------------------------------------- */

class MTNDisbursements {
  constructor({
    disbursementService,

    beneficiaryService,

    approvalService,

    fraudGuard,

    idempotencyManager,

    authorizationService,

    callbackCorrelation,

    settlementTracker,

    auditService,

    eventPublisher,

    outboxService,

    tenantResolver,

    logger,

    metrics,

    tracer,

    config = {}
  } = {}) {
    this.disbursementService =
      disbursementService;

    this.beneficiaryService =
      beneficiaryService;

    this.approvalService =
      approvalService;

    this.fraudGuard =
      fraudGuard;

    this.idempotencyManager =
      idempotencyManager;

    this.authorizationService =
      authorizationService;

    this.callbackCorrelation =
      callbackCorrelation;

    this.settlementTracker =
      settlementTracker;

    this.auditService =
      auditService;

    this.eventPublisher =
      eventPublisher;

    this.outboxService =
      outboxService;

    this.tenantResolver =
      tenantResolver;

    this.logger =
      resolveLogger(
        logger
      );

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.config = {
      timeoutMs:
        Number.isFinite(
          config.timeoutMs
        ) &&
        config.timeoutMs > 0
          ? config.timeoutMs
          : DEFAULT_TIMEOUT_MS,

      maxRetries:
        Number.isFinite(
          config.maxRetries
        ) &&
        config.maxRetries >= 0
          ? config.maxRetries
          : DEFAULT_MAX_RETRIES,

      retryBaseMs:
        Number.isFinite(
          config.retryBaseMs
        ) &&
        config.retryBaseMs > 0
          ? config.retryBaseMs
          : DEFAULT_RETRY_BASE_MS,

      retryMaxMs:
        Number.isFinite(
          config.retryMaxMs
        ) &&
        config.retryMaxMs > 0
          ? config.retryMaxMs
          : DEFAULT_RETRY_MAX_MS,

      requireTenant:
        config.requireTenant !==
        undefined
          ? Boolean(
              config.requireTenant
            )
          : true,

      requireApproval:
        config.requireApproval !==
        undefined
          ? Boolean(
              config.requireApproval
            )
          : true,

      useOutbox:
        config.useOutbox !==
        undefined
          ? Boolean(
              config.useOutbox
            )
          : true
    };

    this.statistics = {
      initiated: 0,
      accepted: 0,
      pending: 0,
      failed: 0,
      rejected: 0,
      duplicates: 0,
      retries: 0,
      compensated: 0
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Tenant                                                                   */
  /* ------------------------------------------------------------------------ */

  async resolveTenant(
    input
  ) {
    if (
      input.tenantId
    ) {
      return input.tenantId;
    }

    if (
      !this.config.requireTenant
    ) {
      return undefined;
    }

    if (
      !this.tenantResolver
    ) {
      throw new MTNDisbursementError(
        'Tenant could not be resolved.',
        ERROR_CODES.TENANT_REQUIRED,
        undefined,
        {
          httpStatus: 400,
          rejected: true
        }
      );
    }

    if (
      typeof this
        .tenantResolver
        .resolveMTN ===
      'function'
    ) {
      const result =
        await this.tenantResolver.resolveMTN(
          {
            tenantId:
              input.tenantId,

            reference:
              input.reference,

            provider:
              'MTN'
          }
        );

      return normalizeId(
        result?.tenantId ||
          result?.id ||
          result
      );
    }

    if (
      typeof this
        .tenantResolver
        .resolve ===
      'function'
    ) {
      const result =
        await this.tenantResolver.resolve(
          {
            provider:
              'MTN',

            tenantId:
              input.tenantId,

            reference:
              input.reference
          }
        );

      return normalizeId(
        result?.tenantId ||
          result?.id ||
          result
      );
    }

    throw new MTNDisbursementError(
      'Tenant resolver contract is unsupported.',
      ERROR_CODES.CONFIGURATION_ERROR
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Authorization                                                            */
  /* ------------------------------------------------------------------------ */

  async assertAuthorized(
    input
  ) {
    if (
      !this.authorizationService
    ) {
      return true;
    }

    const request = {
      tenantId:
        input.tenantId,

      actorId:
        input.requestedBy,

      action:
        'payment.disbursement.initiate',

      resource:
        'mtn_disbursement',

      resourceId:
        input.reference
    };

    if (
      typeof this
        .authorizationService
        .assert ===
      'function'
    ) {
      await this.authorizationService.assert(
        request
      );

      return true;
    }

    if (
      typeof this
        .authorizationService
        .can ===
      'function'
    ) {
      const allowed =
        await this.authorizationService.can(
          request
        );

      if (
        !allowed
      ) {
        throw new MTNDisbursementError(
          'Disbursement initiation is not authorized.',
          ERROR_CODES.AUTHORIZATION_DENIED,
          undefined,
          {
            httpStatus: 403,
            rejected: true
          }
        );
      }
    }

    return true;
  }

  /* ------------------------------------------------------------------------ */
  /* Beneficiary                                                              */
  /* ------------------------------------------------------------------------ */

  async validateBeneficiary(
    input
  ) {
    if (
      !this.beneficiaryService
    ) {
      /*
       * The service is optional only for deployments where beneficiary
       * validation has already occurred in the canonical disbursement domain
       * service.
       */
      return {
        valid:
          true
      };
    }

    let result;

    if (
      typeof this
        .beneficiaryService
        .validate ===
      'function'
    ) {
      result =
        await this.beneficiaryService.validate(
          {
            tenantId:
              input.tenantId,

            beneficiary:
              input.beneficiary,

            type:
              input.type,

            amount:
              input.amount,

            currency:
              input.currency,

            requestedBy:
              input.requestedBy,

            correlationId:
              input.correlationId
          }
        );
    } else if (
      typeof this
        .beneficiaryService
        .verify ===
      'function'
    ) {
      result =
        await this.beneficiaryService.verify(
          {
            tenantId:
              input.tenantId,

            beneficiary:
              input.beneficiary,

            type:
              input.type
          }
        );
    }

    if (
      result ===
        false ||
      result?.valid ===
        false ||
      result?.allowed ===
        false
    ) {
      throw new MTNDisbursementError(
        'Beneficiary validation failed.',
        ERROR_CODES.BENEFICIARY_INVALID,
        undefined,
        {
          httpStatus:
            400,
          rejected:
            true
        }
      );
    }

    return (
      result || {
        valid:
          true
      }
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Approval                                                                 */
  /* ------------------------------------------------------------------------ */

  async enforceApproval(
    input
  ) {
    if (
      !this.config.requireApproval ||
      !this.approvalService
    ) {
      return {
        required:
          false,
        approved:
          true
      };
    }

    if (
      typeof this
        .approvalService
        .assertApproved ===
      'function'
    ) {
      await this.approvalService.assertApproved(
        {
          tenantId:
            input.tenantId,

          operation:
            'DISBURSEMENT',

          reference:
            input.reference,

          requestedBy:
            input.requestedBy,

          approvalId:
            input.approvalId,

          approvedBy:
            input.approvedBy,

          type:
            input.type,

          amount:
            input.amount,

          currency:
            input.currency
        }
      );

      return {
        required:
          true,
        approved:
          true
      };
    }

    if (
      typeof this
        .approvalService
        .check ===
      'function'
    ) {
      const result =
        await this.approvalService.check(
          {
            tenantId:
              input.tenantId,

            reference:
              input.reference,

            requestedBy:
              input.requestedBy,

            approvalId:
              input.approvalId
          }
        );

      if (
        result?.required ===
          true &&
        result?.approved !==
          true
      ) {
        throw new MTNDisbursementError(
          'Disbursement approval is required before provider submission.',
          ERROR_CODES.APPROVAL_REQUIRED,
          undefined,
          {
            httpStatus:
              409,
            rejected:
              true
          }
        );
      }

      return {
        required:
          Boolean(
            result?.required
          ),
        approved:
          result?.approved !==
            false
      };
    }

    /*
     * A configured approval service without a supported contract must fail
     * closed rather than silently bypass maker/checker controls.
     */
    throw new MTNDisbursementError(
      'Approval service does not expose a supported authorization contract.',
      ERROR_CODES.CONFIGURATION_ERROR
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Fraud                                                                    */
  /* ------------------------------------------------------------------------ */

  async inspectFraud(
    input
  ) {
    if (
      !this.fraudGuard
    ) {
      return {
        allowed:
          true
      };
    }

    let result;

    if (
      typeof this
        .fraudGuard
        .inspect ===
      'function'
    ) {
      result =
        await this.fraudGuard.inspect(
          {
            tenantId:
              input.tenantId,

            beneficiary:
              input.beneficiary,

            amount:
              input.amount,

            currency:
              input.currency,

            type:
              input.type,

            reference:
              input.reference,

            requestedBy:
              input.requestedBy,

            metadata:
              input.metadata,

            correlationId:
              input.correlationId
          }
        );
    }

    if (
      result ===
        false ||
      result?.allowed ===
        false ||
      result?.decision ===
        'BLOCK'
    ) {
      throw new MTNDisbursementError(
        'Disbursement was rejected by the configured fraud/risk controls.',
        ERROR_CODES.FRAUD_REJECTED,
        undefined,
        {
          httpStatus:
            403,
          rejected:
            true
        }
      );
    }

    return (
      result || {
        allowed:
          true
      }
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Idempotency                                                              */
  /* ------------------------------------------------------------------------ */

  async checkIdempotency(
    input
  ) {
    if (
      !this.idempotencyManager
    ) {
      return null;
    }

    const request = {
      tenantId:
        input.tenantId,

      idempotencyKey:
        input.idempotencyKey,

      externalId:
        input.reference,

      requestFingerprint:
        input.requestFingerprint
    };

    let result;

    if (
      typeof this
        .idempotencyManager
        .check ===
      'function'
    ) {
      result =
        await this.idempotencyManager.check(
          request
        );
    } else if (
      typeof this
        .idempotencyManager
        .get ===
      'function'
    ) {
      result =
        await this.idempotencyManager.get(
          request
        );
    }

    if (
      !result
    ) {
      return null;
    }

    const fingerprint =
      result.requestFingerprint ||
      result.fingerprint;

    if (
      fingerprint &&
      fingerprint !==
        input.requestFingerprint
    ) {
      throw new MTNDisbursementError(
        'Idempotency key was reused for a different disbursement request.',
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        undefined,
        {
          httpStatus:
            409,
          conflict:
            true
        }
      );
    }

    return result;
  }

  async registerIdempotency(
    input,
    result
  ) {
    if (
      !this.idempotencyManager
    ) {
      return;
    }

    const request = {
      tenantId:
        input.tenantId,

      idempotencyKey:
        input.idempotencyKey,

      externalId:
        input.reference,

      requestFingerprint:
        input.requestFingerprint,

      result
    };

    if (
      typeof this
        .idempotencyManager
        .register ===
      'function'
    ) {
      await this.idempotencyManager.register(
        request
      );

      return;
    }

    if (
      typeof this
        .idempotencyManager
        .store ===
      'function'
    ) {
      await this.idempotencyManager.store(
        request
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Internal disbursement                                                    */
  /* ------------------------------------------------------------------------ */

  async createInternalDisbursement(
    input
  ) {
    requireDependency(
      this.disbursementService,
      'disbursementService'
    );

    const request = {
      tenantId:
        input.tenantId,

      beneficiary:
        input.beneficiary,

      amount:
        input.amount,

      currency:
        input.currency,

      type:
        input.type,

      reference:
        input.reference,

      requestedBy:
        input.requestedBy,

      approvedBy:
        input.approvedBy,

      approvalId:
        input.approvalId,

      idempotencyKey:
        input.idempotencyKey,

      requestFingerprint:
        input.requestFingerprint,

      correlationId:
        input.correlationId,

      metadata:
        input.metadata
    };

    if (
      typeof this
        .disbursementService
        .createPending ===
      'function'
    ) {
      return this.disbursementService.createPending(
        request
      );
    }

    if (
      typeof this
        .disbursementService
        .create ===
      'function'
    ) {
      return this.disbursementService.create(
        request
      );
    }

    /*
     * Existing installations may expose initiate() as the domain boundary.
     * It is intentionally treated as a delegated domain operation rather
     * than a direct MTN HTTP call.
     */
    if (
      typeof this
        .disbursementService
        .initiate ===
      'function'
    ) {
      return this.disbursementService.initiate(
        request
      );
    }

    throw new MTNDisbursementError(
      'Disbursement service does not expose a supported creation contract.',
      ERROR_CODES.INTERNAL_CREATE_FAILED
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Provider submission                                                      */
  /* ------------------------------------------------------------------------ */

  async submitProvider(
    input
  ) {
    /*
     * The actual MTN provider submission remains inside
     * disbursementService. This gateway intentionally does not implement
     * OAuth, endpoint construction, or provider protocol details.
     *
     * Supported domain service contracts:
     *
     *   submitProvider()
     *   submit()
     *   executeProvider()
     */
    requireDependency(
      this.disbursementService,
      'disbursementService'
    );

    const request = {
      tenantId:
        input.tenantId,

      reference:
        input.reference,

      beneficiary:
        input.beneficiary,

      amount:
        input.amount,

      currency:
        input.currency,

      type:
        input.type,

      requestedBy:
        input.requestedBy,

      approvalId:
        input.approvalId,

      correlationId:
        input.correlationId,

      idempotencyKey:
        input.idempotencyKey,

      metadata:
        input.metadata
    };

    let attempt =
      0;

    let lastError;

    while (
      attempt <=
      this.config.maxRetries
    ) {
      attempt +=
        1;

      try {
        if (
          typeof this
            .disbursementService
            .submitProvider ===
          'function'
        ) {
          const result =
            await this.disbursementService.submitProvider(
              request
            );

          return normalizeProviderSubmissionResult(
            result
          );
        }

        if (
          typeof this
            .disbursementService
            .submit ===
          'function'
        ) {
          const result =
            await this.disbursementService.submit(
              request
            );

          return normalizeProviderSubmissionResult(
            result
          );
        }

        if (
          typeof this
            .disbursementService
            .executeProvider ===
          'function'
        ) {
          const result =
            await this.disbursementService.executeProvider(
              request
            );

          return normalizeProviderSubmissionResult(
            result
          );
        }

        throw new MTNDisbursementError(
          'Disbursement service does not expose a provider submission contract.',
          ERROR_CODES.CONFIGURATION_ERROR
        );
      } catch (
        error
      ) {
        lastError =
          normalizeDisbursementError(
            error
          );

        if (
          !lastError.retryable ||
          attempt >
            this.config.maxRetries
        ) {
          break;
        }

        this.statistics.retries +=
          1;

        const delay =
          calculateRetryDelay(
            attempt,
            this.config.retryBaseMs,
            this.config.retryMaxMs
          );

        await sleep(
          delay
        );
      }
    }

    throw (
      lastError ||
      new MTNDisbursementError(
        'MTN disbursement submission failed.',
        ERROR_CODES.PROVIDER_FAILED
      )
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Settlement tracking                                                      */
  /* ------------------------------------------------------------------------ */

  async registerSettlement(
    input,
    provider
  ) {
    if (
      !this.settlementTracker
    ) {
      /*
       * Settlement registration is considered mandatory for deployments
       * using asynchronous provider settlement. Do not silently skip it.
       */
      throw new MTNDisbursementError(
        'Settlement tracker is not configured.',
        ERROR_CODES.SETTLEMENT_FAILED
      );
    }

    const request = {
      tenantId:
        input.tenantId,

      reference:
        input.reference,

      paymentReference:
        input.reference,

      provider:
        'MTN',

      providerTransactionId:
        provider.providerReference,

      amount:
        input.amount,

      currency:
        input.currency,

      type:
        input.type,

      correlationId:
        input.correlationId,

      metadata: {
        disbursementType:
          input.type,

        providerStatus:
          provider.providerStatus,

        providerCode:
          provider.providerCode,

        providerHttpStatus:
          provider.httpStatus
      }
    };

    if (
      typeof this
        .settlementTracker
        .register ===
      'function'
    ) {
      return this.settlementTracker.register(
        request
      );
    }

    if (
      typeof this
        .settlementTracker
        .create ===
      'function'
    ) {
      return this.settlementTracker.create(
        request
      );
    }

    throw new MTNDisbursementError(
      'Settlement tracker does not expose a supported registration method.',
      ERROR_CODES.SETTLEMENT_FAILED
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Callback correlation                                                     */
  /* ------------------------------------------------------------------------ */

  async correlate(
    reference,
    optionsArg = {}
  ) {
    const normalizedReference =
      normalizeReference(
        reference
      );

    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    if (
      !tenantId
    ) {
      throw new MTNDisbursementError(
        'tenantId is required when correlating a disbursement callback.',
        ERROR_CODES.TENANT_REQUIRED,
        undefined,
        {
          httpStatus:
            400
        }
      );
    }

    if (
      !this.callbackCorrelation
    ) {
      throw new MTNDisbursementError(
        'Callback correlation service is not configured.',
        ERROR_CODES.CALLBACK_CORRELATION_FAILED
      );
    }

    if (
      typeof this
        .callbackCorrelation
        .correlate !==
      'function'
    ) {
      throw new MTNDisbursementError(
        'Callback correlation service does not support correlate().',
        ERROR_CODES.CALLBACK_CORRELATION_FAILED
      );
    }

    return this.callbackCorrelation.correlate(
      {
        tenantId,

        externalId:
          normalizedReference,

        provider:
          'MTN'
      }
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Query settlement                                                         */
  /* ------------------------------------------------------------------------ */

  async query(
    reference,
    optionsArg = {}
  ) {
    const normalizedReference =
      normalizeReference(
        reference
      );

    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    if (
      !tenantId
    ) {
      throw new MTNDisbursementError(
        'tenantId is required when querying a disbursement.',
        ERROR_CODES.TENANT_REQUIRED,
        undefined,
        {
          httpStatus:
            400
        }
      );
    }

    if (
      !this.settlementTracker
    ) {
      throw new MTNDisbursementError(
        'Settlement tracker is not configured.',
        ERROR_CODES.SETTLEMENT_FAILED
      );
    }

    if (
      typeof this
        .settlementTracker
        .reconcile ===
      'function'
    ) {
      return this.settlementTracker.reconcile(
        {
          tenantId,
          reference:
            normalizedReference
        }
      );
    }

    if (
      typeof this
        .settlementTracker
        .find ===
      'function'
    ) {
      return this.settlementTracker.find(
        {
          tenantId,
          reference:
            normalizedReference
        }
      );
    }

    throw new MTNDisbursementError(
      'Settlement tracker does not support settlement lookup.',
      ERROR_CODES.SETTLEMENT_FAILED
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Compensation                                                             */
  /* ------------------------------------------------------------------------ */

  async compensate(
    input = {}
  ) {
    const tenantId =
      normalizeId(
        input.tenantId
      );

    const reference =
      normalizeReference(
        input.reference
      );

    const reason =
      normalizeString(
        input.reason,
        2000
      );

    if (
      !reason
    ) {
      throw new MTNDisbursementError(
        'A compensation reason is required.',
        ERROR_CODES.COMPENSATION_FAILED,
        undefined,
        {
          httpStatus:
            400,
          rejected:
            true
        }
      );
    }

    if (
      !tenantId
    ) {
      throw new MTNDisbursementError(
        'tenantId is required.',
        ERROR_CODES.TENANT_REQUIRED,
        undefined,
        {
          httpStatus:
            400
        }
      );
    }

    if (
      !this.disbursementService
    ) {
      throw new MTNDisbursementError(
        'Disbursement service is not configured.',
        ERROR_CODES.COMPENSATION_FAILED
      );
    }

    try {
      /*
       * Compensation is itself a financial action and must therefore remain
       * inside the canonical financial/disbursement domain service.
       */
      let result;

      if (
        typeof this
          .disbursementService
          .compensate ===
        'function'
      ) {
        result =
          await this
            .disbursementService
            .compensate(
              {
                tenantId,

                reference,

                reason,

                requestedBy:
                  normalizeId(
                    input.requestedBy
                  ),

                correlationId:
                  normalizeId(
                    input.correlationId
                  ) ||
                  createCorrelationId()
              }
            );
      } else if (
        typeof this
          .disbursementService
          .reverse ===
        'function'
      ) {
        result =
          await this
            .disbursementService
            .reverse(
              {
                tenantId,

                reference,

                reason,

                requestedBy:
                  normalizeId(
                    input.requestedBy
                  ),

                correlationId:
                  normalizeId(
                    input.correlationId
                  ) ||
                  createCorrelationId()
              }
            );
      } else {
        throw new MTNDisbursementError(
          'Disbursement service does not expose a compensation/reversal contract.',
          ERROR_CODES.COMPENSATION_FAILED
        );
      }

      this.statistics.compensated +=
        1;

      await this.audit(
        'MTN_DISBURSEMENT_COMPENSATED',
        {
          tenantId,

          reference,

          correlationId:
            input.correlationId
        },
        {
          reason
        }
      );

      return result;
    } catch (
      error
    ) {
      throw (
        error instanceof
        MTNDisbursementError
          ? error
          : new MTNDisbursementError(
              'MTN disbursement compensation failed.',
              ERROR_CODES.COMPENSATION_FAILED,
              undefined,
              {
                retryable:
                  Boolean(
                    error?.retryable
                  )
              }
            )
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Audit                                                                    */
  /* ------------------------------------------------------------------------ */

  async audit(
    eventType,
    input,
    metadata = {}
  ) {
    if (
      !this.auditService
    ) {
      return;
    }

    const payload = {
      eventType,

      action:
        eventType,

      provider:
        'MTN',

      tenantId:
        input.tenantId,

      reference:
        input.reference,

      transactionId:
        input.transactionId,

      correlationId:
        input.correlationId,

      actorId:
        input.requestedBy,

      metadata:
        sanitize(
          metadata
        )
    };

    try {
      if (
        typeof this
          .auditService
          .recordEvent ===
        'function'
      ) {
        await this.auditService.recordEvent(
          eventType,
          payload
        );

        return;
      }

      if (
        typeof this
          .auditService
          .record ===
        'function'
      ) {
        await this.auditService.record(
          payload
        );
      }
    } catch (
      error
    ) {
      this.logger.error?.(
        {
          provider:
            'MTN',

          tenantId:
            input.tenantId,

          reference:
            input.reference,

          correlationId:
            input.correlationId,

          error:
            serializeError(
              error
            )
        },
        'Failed to record MTN disbursement audit event'
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Events / Outbox                                                          */
  /* ------------------------------------------------------------------------ */

  async publishCreatedEvent(
    input,
    result,
    provider
  ) {
    const event = {
      type:
        'MTN_DISBURSEMENT_CREATED',

      provider:
        'MTN',

      tenantId:
        input.tenantId,

      aggregateType:
        'Disbursement',

      aggregateId:
        normalizeId(
          result?.id ||
            result?._id ||
            result?.transactionId ||
            input.reference
        ),

      occurredAt:
        new Date(),

      idempotencyKey:
        `${input.idempotencyKey}:event`,

      correlationId:
        input.correlationId,

      payload: {
        reference:
          input.reference,

        transactionId:
          normalizeId(
            result?.transactionId ||
              result?.id ||
              result?._id
          ),

        type:
          input.type,

        amount:
          input.amount,

        currency:
          input.currency,

        provider:
          'MTN',

        providerReference:
          provider?.providerReference,

        status:
          result?.status ||
          DISBURSEMENT_STATUSES
            .PENDING_CALLBACK
      }
    };

    if (
      this.config.useOutbox &&
      this.outboxService
    ) {
      if (
        typeof this
          .outboxService
          .enqueue ===
        'function'
      ) {
        return this.outboxService.enqueue(
          event
        );
      }

      if (
        typeof this
          .outboxService
          .publishTransactional ===
        'function'
      ) {
        return this.outboxService.publishTransactional(
          event
        );
      }
    }

    if (
      this.eventPublisher &&
      typeof this
        .eventPublisher
        .publish ===
      'function'
    ) {
      return this.eventPublisher.publish(
        event
      );
    }

    return {
      published:
        false,
      skipped:
        true
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Main disbursement operation                                              */
  /* ------------------------------------------------------------------------ */

  async disburse(
    input = {}
  ) {
    const span =
      this.tracer?.startSpan?.(
        'payment.mtn.disbursement'
      );

    let normalized;

    try {
      normalized =
        normalizeInput(
          input
        );

      this.statistics.initiated +=
        1;

      /*
       * 1. Tenant scope.
       */
      normalized.tenantId =
        await this.resolveTenant(
          normalized
        );

      if (
        !normalized.tenantId
      ) {
        throw new MTNDisbursementError(
          'Tenant could not be resolved.',
          ERROR_CODES.TENANT_REQUIRED
        );
      }

      /*
       * 2. Authorization.
       */
      await this.assertAuthorized(
        normalized
      );

      /*
       * 3. Idempotency BEFORE external side effects.
       */
      const existing =
        await this.checkIdempotency(
          normalized
        );

      if (
        existing
      ) {
        this.statistics.duplicates +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_disbursement_duplicate_total',
          {
            tenantId:
              normalized.tenantId
          }
        );

        return {
          success:
            true,

          idempotent:
            true,

          duplicate:
            true,

          tenantId:
            normalized.tenantId,

          reference:
            normalized.reference,

          transactionId:
            existing.transactionId ||
            existing.result?.transactionId,

          status:
            existing.status ||
            existing.result?.status ||
            DISBURSEMENT_STATUSES
              .PENDING_CALLBACK,

          correlationId:
            normalized.correlationId
        };
      }

      /*
       * 4. Beneficiary validation.
       */
      await this.validateBeneficiary(
        normalized
      );

      /*
       * 5. Maker/checker / approval enforcement.
       *
       * Approval is deliberately performed before provider side effects.
       */
      await this.enforceApproval(
        normalized
      );

      /*
       * 6. Fraud/risk pre-check.
       */
      await this.inspectFraud(
        normalized
      );

      /*
       * 7. Create authoritative internal disbursement.
       *
       * The domain service owns the financial record. This gateway does not
       * mutate balances or reserve funds directly.
       */
      const transaction =
        await this.createInternalDisbursement(
          normalized
        );

      normalized.transactionId =
        normalizeId(
          transaction?.transactionId ||
            transaction?.id ||
            transaction?._id
        );

      if (
        !normalized.transactionId
      ) {
        throw new MTNDisbursementError(
          'Internal disbursement creation returned no transaction identifier.',
          ERROR_CODES.INTERNAL_CREATE_FAILED
        );
      }

      /*
       * 8. Provider submission.
       */
      const provider =
        await this.submitProvider(
          normalized
        );

      /*
       * 9. Provider failure.
       */
      if (
        provider.outcome ===
        PROVIDER_OUTCOMES.FAILED
      ) {
        this.statistics.failed +=
          1;

        await this.audit(
          'MTN_DISBURSEMENT_FAILED',
          normalized,
          {
            transactionId:
              normalized.transactionId,

            providerReference:
              provider.providerReference,

            providerStatus:
              provider.providerStatus,

            providerCode:
              provider.providerCode,

            providerHttpStatus:
              provider.httpStatus
          }
        );

        return {
          success:
            false,

          tenantId:
            normalized.tenantId,

          reference:
            normalized.reference,

          transactionId:
            normalized.transactionId,

          providerReference:
            provider.providerReference,

          providerStatus:
            provider.providerStatus,

          status:
            DISBURSEMENT_STATUSES.FAILED,

          correlationId:
            normalized.correlationId
        };
      }

      /*
       * 10. Provider accepted/pending.
       *
       * No settlement is implied.
       */
      const providerPending =
        provider.outcome ===
        PROVIDER_OUTCOMES.PENDING;

      const status =
        providerPending
          ? DISBURSEMENT_STATUSES.PENDING_PROVIDER
          : DISBURSEMENT_STATUSES.PENDING_CALLBACK;

      /*
       * 11. Register settlement tracking.
       *
       * If this fails after provider acceptance, do not tell the caller that
       * the payment is settled. Instead surface reconciliation/operational
       * failure for recovery.
       */
      try {
        await this.registerSettlement(
          normalized,
          provider
        );
      } catch (
        error
      ) {
        await this.audit(
          'MTN_DISBURSEMENT_REQUIRES_RECONCILIATION',
          normalized,
          {
            transactionId:
              normalized.transactionId,

            providerReference:
              provider.providerReference,

            error:
              serializeError(
                error
              )
          }
        );

        this.statistics.pending +=
          1;

        return {
          success:
            false,

          accepted:
            provider.outcome ===
            PROVIDER_OUTCOMES.ACCEPTED,

          requiresReconciliation:
            true,

          tenantId:
            normalized.tenantId,

          reference:
            normalized.reference,

          transactionId:
            normalized.transactionId,

          providerReference:
            provider.providerReference,

          status:
            DISBURSEMENT_STATUSES
              .REQUIRES_RECONCILIATION,

          correlationId:
            normalized.correlationId
        };
      }

      /*
       * 12. Idempotency record.
       */
      const result = {
        success:
          true,

        accepted:
          provider.outcome ===
          PROVIDER_OUTCOMES.ACCEPTED,

        pending:
          true,

        tenantId:
          normalized.tenantId,

        reference:
          normalized.reference,

        transactionId:
          normalized.transactionId,

        providerReference:
          provider.providerReference,

        providerStatus:
          provider.providerStatus,

        status,

        correlationId:
          normalized.correlationId,

        idempotencyKey:
          normalized.idempotencyKey
      };

      await this.registerIdempotency(
        normalized,
        result
      );

      /*
       * 13. Audit.
       */
      await this.audit(
        'MTN_DISBURSEMENT_REQUESTED',
        normalized,
        {
          transactionId:
            normalized.transactionId,

          providerReference:
            provider.providerReference,

          providerStatus:
            provider.providerStatus,

          status,

          amount:
            normalized.amount,

          currency:
            normalized.currency,

          type:
            normalized.type
        }
      );

      /*
       * 14. Event/outbox.
       */
      try {
        await this.publishCreatedEvent(
          normalized,
          result,
          provider
        );
      } catch (
        error
      ) {
        /*
         * Direct event failure is an operational issue. A transactional
         * outbox should be the preferred production implementation so that
         * event publication is durable without coupling financial state to
         * an external message system.
         */
        this.logger.error?.(
          {
            provider:
              'MTN',

            tenantId:
              normalized.tenantId,

            reference:
              normalized.reference,

            transactionId:
              normalized.transactionId,

            error:
              serializeError(
                error
              )
          },
          'MTN disbursement event publication failed'
        );

        this.metrics?.counter?.(
          'payment_mtn_disbursement_event_failure_total',
          {
            tenantId:
              normalized.tenantId
          }
        );
      }

      if (
        provider.outcome ===
        PROVIDER_OUTCOMES.ACCEPTED
      ) {
        this.statistics.accepted +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_disbursement_accepted_total',
          {
            tenantId:
              normalized.tenantId
          }
        );
      } else {
        this.statistics.pending +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_disbursement_pending_total',
          {
            tenantId:
              normalized.tenantId
          }
        );
      }

      this.metrics?.counter?.(
        'payment_mtn_disbursement_success_total',
        {
          tenantId:
            normalized.tenantId
        }
      );

      return result;
    } catch (
      error
    ) {
      const normalizedError =
        normalizeDisbursementError(
          error
        );

      if (
        normalizedError.rejected
      ) {
        this.statistics.rejected +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_disbursement_rejected_total',
          {
            tenantId:
              normalized?.tenantId
          }
        );
      } else {
        this.statistics.failed +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_disbursement_failure_total',
          {
            tenantId:
              normalized?.tenantId
          }
        );
      }

      if (
        normalized
      ) {
        await this.audit(
          'MTN_DISBURSEMENT_FAILED',
          normalized,
          {
            transactionId:
              normalized.transactionId,

            error:
              serializeError(
                normalizedError
              )
          }
        );
      }

      this.logger.error?.(
        {
          provider:
            'MTN',

          tenantId:
            normalized?.tenantId,

          reference:
            normalized?.reference,

          transactionId:
            normalized?.transactionId,

          correlationId:
            normalized?.correlationId,

          error:
            serializeError(
              normalizedError
            )
        },
        'MTN disbursement failed'
      );

      throw normalizedError;
    } finally {
      span?.setAttribute?.(
        'payment.provider',
        'MTN'
      );

      span?.setAttribute?.(
        'payment.operation',
        'disbursement'
      );

      span?.end?.();
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Health                                                                   */
  /* ------------------------------------------------------------------------ */

  health() {
    const dependencies = {
      disbursementService:
        Boolean(
          this.disbursementService
        ),

      beneficiaryService:
        Boolean(
          this.beneficiaryService
        ),

      approvalService:
        Boolean(
          this.approvalService
        ),

      fraudGuard:
        Boolean(
          this.fraudGuard
        ),

      idempotencyManager:
        Boolean(
          this.idempotencyManager
        ),

      authorizationService:
        Boolean(
          this.authorizationService
        ),

      callbackCorrelation:
        Boolean(
          this.callbackCorrelation
        ),

      settlementTracker:
        Boolean(
          this.settlementTracker
        ),

      auditService:
        Boolean(
          this.auditService
        ),

      outboxService:
        Boolean(
          this.outboxService
        )
    };

    const required =
      dependencies.disbursementService &&
      dependencies.callbackCorrelation &&
      dependencies.settlementTracker;

    return {
      provider:
        'MTN',

      module:
        'disbursements',

      status:
        required
          ? 'UP'
          : 'DOWN',

      requiredDependenciesReady:
        required,

      dependencies,

      statistics: {
        ...this.statistics
      },

      configuration: {
        timeoutMs:
          this.config.timeoutMs,

        maxRetries:
          this.config.maxRetries,

        requireTenant:
          this.config.requireTenant,

        requireApproval:
          this.config.requireApproval,

        useOutbox:
          this.config.useOutbox
      }
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Diagnostics                                                              */
  /* ------------------------------------------------------------------------ */

  diagnostics() {
    return sanitize({
      provider:
        'MTN',

      module:
        'disbursements',

      statistics:
        this.statistics,

      configuration: {
        timeoutMs:
          this.config.timeoutMs,

        maxRetries:
          this.config.maxRetries,

        requireTenant:
          this.config.requireTenant,

        requireApproval:
          this.config.requireApproval,

        useOutbox:
          this.config.useOutbox
      }
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Provider result normalization                                              */
/* -------------------------------------------------------------------------- */

function normalizeProviderSubmissionResult(
  result
) {
  if (
    result ===
    undefined ||
    result ===
    null
  ) {
    throw new MTNDisbursementError(
      'MTN disbursement submission returned no result.',
      ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      undefined,
      {
        retryable:
          true
      }
    );
  }

  /*
   * Domain services may already return a normalized result.
   */
  if (
    result.outcome
  ) {
    return result;
  }

  /*
   * Axios/fetch-like result.
   */
  if (
    result.status ||
    result.ok !== undefined ||
    result.data
  ) {
    const normalized =
      normalizeProviderResponse(
        result
      );

    if (
      normalized.outcome ===
      PROVIDER_OUTCOMES.UNKNOWN
    ) {
      return {
        ...normalized,
        outcome:
          PROVIDER_OUTCOMES.UNKNOWN
      };
    }

    return normalized;
  }

  /*
   * Simple provider/domain result object.
   */
  const status =
    normalizeString(
      result.status ||
        result.state ||
        result.providerStatus,
      128
    )?.toUpperCase();

  let outcome =
    PROVIDER_OUTCOMES.UNKNOWN;

  if (
    [
      'SUCCESS',
      'SUCCESSFUL',
      'ACCEPTED',
      'COMPLETED'
    ].includes(
      status
    )
  ) {
    outcome =
      PROVIDER_OUTCOMES.ACCEPTED;
  } else if (
    [
      'PENDING',
      'PROCESSING',
      'QUEUED',
      'IN_PROGRESS'
    ].includes(
      status
    )
  ) {
    outcome =
      PROVIDER_OUTCOMES.PENDING;
  } else if (
    [
      'FAILED',
      'REJECTED',
      'DECLINED',
      'CANCELLED'
    ].includes(
      status
    )
  ) {
    outcome =
      PROVIDER_OUTCOMES.FAILED;
  }

  return {
    outcome,

    providerReference:
      normalizeId(
        result.providerReference ||
          result.referenceId ||
          result.transactionId
      ),

    providerStatus:
      normalizeString(
        result.providerStatus ||
          result.status ||
          result.state,
        128
      ),

    providerCode:
      normalizeString(
        result.providerCode ||
          result.code,
        128
      ),

    httpStatus:
      Number.isFinite(
        Number(
          result.httpStatus ||
            result.statusCode
        )
      )
        ? Number(
            result.httpStatus ||
              result.statusCode
          )
        : undefined,

    rawMeta:
      sanitize(
        result.metadata ||
          {}
      )
  };
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

function requireDependency(
  dependency,
  name
) {
  if (!dependency) {
    throw new MTNDisbursementError(
      `${name} dependency is not configured.`,
      ERROR_CODES.CONFIGURATION_ERROR,
      {
        dependency:
          name
      }
    );
  }
}

function normalizeDisbursementError(
  error
) {
  if (
    error instanceof
    MTNDisbursementError
  ) {
    return error;
  }

  const message =
    normalizeString(
      error?.message,
      1000
    ) ||
    'MTN disbursement failed.';

  const providerStatus =
    error?.response?.status ||
    error?.providerStatus;

  const retryable =
    Boolean(
      error?.retryable
    ) ||
    isTransientStatus(
      providerStatus
    ) ||
    /timeout|temporar|unavailable|ECONNRESET|ECONNREFUSED|deadlock|lock/i.test(
      message
    );

  let code =
    normalizeString(
      error?.code,
      256
    ) ||
    ERROR_CODES.PROVIDER_FAILED;

  if (
    /timeout/i.test(
      message
    )
  ) {
    code =
      ERROR_CODES.PROVIDER_TIMEOUT;
  } else if (
    isTransientStatus(
      providerStatus
    )
  ) {
    code =
      ERROR_CODES.PROVIDER_UNAVAILABLE;
  }

  return new MTNDisbursementError(
    message,
    code,
    undefined,
    {
      retryable,

      httpStatus:
        Number.isFinite(
          error?.httpStatus
        )
          ? error.httpStatus
          : undefined,

      providerStatus,

      providerCode:
        error?.providerCode,

      conflict:
        Boolean(
          error?.conflict
        ),

      rejected:
        Boolean(
          error?.rejected
        )
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

module.exports =
  MTNDisbursements;

module.exports.MTNDisbursements =
  MTNDisbursements;

module.exports.MTNDisbursementError =
  MTNDisbursementError;

module.exports.DISBURSEMENT_TYPES =
  DISBURSEMENT_TYPES;

module.exports.DISBURSEMENT_STATUSES =
  DISBURSEMENT_STATUSES;

module.exports.PROVIDER_OUTCOMES =
  PROVIDER_OUTCOMES;

module.exports.ERROR_CODES =
  ERROR_CODES;