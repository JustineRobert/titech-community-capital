'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Loan Workflow Service
 * ============================================================================
 *
 * File:
 *   backend/services/loanWorkflowService.js
 *
 * Purpose:
 *   Canonical orchestration layer for the TITech loan lifecycle.
 *
 * Architectural boundaries:
 *   - This service owns loan workflow/state orchestration.
 *   - It does NOT perform double-entry accounting.
 *   - It does NOT create ledger entries.
 *   - It does NOT independently move customer funds.
 *   - Financial transactions must be executed by the transaction/ledger layer.
 *
 * Compatibility:
 *   - CommonJS
 *   - Existing Loan model preserved
 *   - Existing LoanRepaymentSchedule model preserved
 *   - Existing LoanAudit model preserved
 *   - Existing public method names preserved
 *   - MongoDB/Mongoose sessions supported
 *
 * IMPORTANT MODEL CONTRACT:
 *
 * Loan fields used by this service:
 *   user
 *   member
 *   group
 *   amount
 *   interestRate
 *   repaymentPeriodMonths
 *   status
 *   approvedBy
 *   approvedAt
 *   disbursedAt
 *   completedAt
 *   cancelledAt
 *   rejectedAt
 *   defaultedAt
 *   outstandingBalance
 *   amountDue
 *   amountRepaid
 *   lastPaymentDate
 *   nextPaymentDate
 *   disbursedAmount
 *   disbursementMethod
 *   disbursementReference
 *   tenantId
 *   workflowVersion
 *
 * Status values are aligned with backend/models/loan.js.
 */

const Loan = require('../models/Loan');
const LoanRepaymentSchedule = require('../models/LoanRepaymentSchedule');
const LoanAudit = require('../models/LoanAudit');
const logger = require('../utils/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const MONEY_SCALE = 100;
const MAX_REASON_LENGTH = 2000;

const SYSTEM_ACTOR = Object.freeze({
  id: 'system',
  role: 'system',
});

const TERMINAL_STATUSES = Object.freeze([
  'completed',
  'cancelled',
  'rejected',
  'written_off',
  'recovered',
]);

/**
 * ============================================================================
 * Loan State Machine
 * ============================================================================
 *
 * This intentionally reflects the Loan schema rather than inventing statuses.
 */

const LOAN_STATUS_MACHINE = Object.freeze({
  draft: Object.freeze({
    allowedTransitions: Object.freeze([
      'pending',
      'cancelled',
    ]),
    description: 'Loan application is being prepared',
    isPending: true,
    isActive: false,
    isOverdue: false,
    isFinal: false,
  }),

  pending: Object.freeze({
    allowedTransitions: Object.freeze([
      'credit_review',
      'manual_review',
      'approved',
      'rejected',
      'cancelled',
    ]),
    description: 'Loan application awaiting review',
    isPending: true,
    isActive: false,
    isOverdue: false,
    isFinal: false,
  }),

  credit_review: Object.freeze({
    allowedTransitions: Object.freeze([
      'manual_review',
      'approved',
      'rejected',
      'cancelled',
    ]),
    description: 'Loan undergoing credit assessment',
    isPending: true,
    isActive: false,
    isOverdue: false,
    isFinal: false,
  }),

  manual_review: Object.freeze({
    allowedTransitions: Object.freeze([
      'approved',
      'rejected',
      'cancelled',
    ]),
    description: 'Loan requires manual credit review',
    isPending: true,
    isActive: false,
    isOverdue: false,
    isFinal: false,
  }),

  approved: Object.freeze({
    allowedTransitions: Object.freeze([
      'disbursed',
      'cancelled',
    ]),
    description: 'Loan approved and awaiting disbursement',
    isPending: false,
    isActive: false,
    isOverdue: false,
    isFinal: false,
  }),

  disbursed: Object.freeze({
    allowedTransitions: Object.freeze([
      'active',
      'cancelled',
    ]),
    description: 'Loan funds have been disbursed',
    isPending: false,
    isActive: false,
    isOverdue: false,
    isFinal: false,
  }),

  active: Object.freeze({
    allowedTransitions: Object.freeze([
      'defaulted',
      'completed',
      'cancelled',
      'restructured',
      'written_off',
    ]),
    description: 'Loan is actively being repaid',
    isPending: false,
    isActive: true,
    isOverdue: false,
    isFinal: false,
  }),

  defaulted: Object.freeze({
    allowedTransitions: Object.freeze([
      'restructured',
      'written_off',
      'recovered',
      'completed',
    ]),
    description: 'Loan has reached default state',
    isPending: false,
    isActive: true,
    isOverdue: true,
    isFinal: false,
  }),

  completed: Object.freeze({
    allowedTransitions: Object.freeze([]),
    description: 'Loan fully repaid',
    isPending: false,
    isActive: false,
    isOverdue: false,
    isFinal: true,
  }),

  rejected: Object.freeze({
    allowedTransitions: Object.freeze([
      'pending',
    ]),
    description: 'Loan application rejected',
    isPending: false,
    isActive: false,
    isOverdue: false,
    isFinal: true,
  }),

  cancelled: Object.freeze({
    allowedTransitions: Object.freeze([]),
    description: 'Loan cancelled',
    isPending: false,
    isActive: false,
    isOverdue: false,
    isFinal: true,
  }),

  written_off: Object.freeze({
    allowedTransitions: Object.freeze([
      'recovered',
    ]),
    description: 'Loan balance written off',
    isPending: false,
    isActive: false,
    isOverdue: true,
    isFinal: false,
  }),

  recovered: Object.freeze({
    allowedTransitions: Object.freeze([]),
    description: 'Written-off/defaulted loan recovered',
    isPending: false,
    isActive: false,
    isOverdue: false,
    isFinal: true,
  }),

  restructured: Object.freeze({
    allowedTransitions: Object.freeze([
      'active',
      'defaulted',
      'written_off',
      'completed',
      'cancelled',
    ]),
    description: 'Loan has been restructured',
    isPending: false,
    isActive: true,
    isOverdue: false,
    isFinal: false,
  }),
});

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class LoanWorkflowError extends Error {
  constructor(
    message,
    code = 'LOAN_WORKFLOW_ERROR',
    details = null
  ) {
    super(message);

    this.name = 'LoanWorkflowError';
    this.code = code;

    if (details !== null) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        LoanWorkflowError
      );
    }
  }
}

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isFiniteNumber(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  );
}

function normalizePositiveNumber(value, fieldName) {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    throw new LoanWorkflowError(
      `${fieldName} must be a positive number`,
      'INVALID_VALUE'
    );
  }

  return number;
}

function normalizeNonNegativeNumber(
  value,
  fieldName
) {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    throw new LoanWorkflowError(
      `${fieldName} must be a non-negative number`,
      'INVALID_VALUE'
    );
  }

  return number;
}

function normalizeInteger(
  value,
  fieldName,
  minimum = 1
) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < minimum
  ) {
    throw new LoanWorkflowError(
      `${fieldName} must be an integer greater than or equal to ${minimum}`,
      'INVALID_INTEGER'
    );
  }

  return number;
}

function roundMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new LoanWorkflowError(
      'Invalid monetary calculation',
      'MONETARY_CALCULATION_ERROR'
    );
  }

  return (
    Math.round(
      (number + Number.EPSILON) *
        MONEY_SCALE
    ) / MONEY_SCALE
  );
}

function toMinorUnits(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new LoanWorkflowError(
      'Invalid monetary value',
      'INVALID_MONETARY_VALUE'
    );
  }

  return Math.round(
    (number + Number.EPSILON) *
      MONEY_SCALE
  );
}

function fromMinorUnits(value) {
  return roundMoney(
    Number(value) / MONEY_SCALE
  );
}

function calculateDaysOverdue(
  dueDate,
  referenceDate
) {
  const due =
    new Date(dueDate).getTime();

  const reference =
    new Date(referenceDate).getTime();

  if (
    !Number.isFinite(due) ||
    !Number.isFinite(reference)
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(
      (reference - due) /
        DAY_MS
    )
  );
}

function cloneDocument(document) {
  if (!document) {
    return document;
  }

  if (
    typeof document.toObject ===
    'function'
  ) {
    return document.toObject({
      depopulate: true,
      versionKey: false,
    });
  }

  try {
    return JSON.parse(
      JSON.stringify(document)
    );
  } catch {
    return document;
  }
}

function normalizeActor(actor) {
  if (
    !actor ||
    actor.id === undefined ||
    actor.id === null
  ) {
    throw new LoanWorkflowError(
      'A valid actor is required',
      'ACTOR_REQUIRED'
    );
  }

  const id =
    String(actor.id).trim();

  if (!id) {
    throw new LoanWorkflowError(
      'Actor ID cannot be empty',
      'ACTOR_REQUIRED'
    );
  }

  return {
    id,
    role: actor.role
      ? String(actor.role).trim()
      : 'system',
  };
}

function normalizeReason(reason) {
  if (
    reason === undefined ||
    reason === null
  ) {
    return '';
  }

  return String(reason)
    .trim()
    .slice(
      0,
      MAX_REASON_LENGTH
    );
}

function normalizeObjectId(
  value,
  fieldName
) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  ) {
    throw new LoanWorkflowError(
      `${fieldName} is required`,
      `${String(fieldName).toUpperCase()}_REQUIRED`
    );
  }

  const normalized =
    String(value).trim();

  if (
    !require('mongoose').isValidObjectId(
      normalized
    )
  ) {
    throw new LoanWorkflowError(
      `${fieldName} is invalid`,
      `INVALID_${String(fieldName).toUpperCase()}`
    );
  }

  return normalized;
}

function safeDate(value, fieldName) {
  const date =
    new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    throw new LoanWorkflowError(
      `${fieldName} must be a valid date`,
      'INVALID_DATE'
    );
  }

  return date;
}

/**
 * ============================================================================
 * Service
 * ============================================================================
 */

class LoanWorkflowService {
  constructor(config = {}) {
    this.statusMachine =
      LOAN_STATUS_MACHINE;

    this.defaultInterestRate =
      config.defaultInterestRate !==
      undefined
        ? Number(
            config.defaultInterestRate
          )
        : 0.15;

    this.defaultTerm =
      config.defaultTerm !==
      undefined
        ? Number(
            config.defaultTerm
          )
        : 12;

    this.overdueDaysThreshold =
      config.overdueDaysThreshold !==
      undefined
        ? Number(
            config.overdueDaysThreshold
          )
        : 0;

    this.defaultDaysThreshold =
      config.defaultDaysThreshold !==
      undefined
        ? Number(
            config.defaultDaysThreshold
          )
        : 30;

    this.minTerm =
      config.minTerm !==
      undefined
        ? Number(config.minTerm)
        : 1;

    this.maxTerm =
      config.maxTerm !==
      undefined
        ? Number(config.maxTerm)
        : 120;

    this.minLoanAmount =
      config.minLoanAmount !==
      undefined
        ? Number(config.minLoanAmount)
        : null;

    this.maxLoanAmount =
      config.maxLoanAmount !==
      undefined
        ? Number(config.maxLoanAmount)
        : null;

    this.clock =
      typeof config.clock ===
      'function'
        ? config.clock
        : () => new Date();

    this.validateConfiguration();
  }

  /**
   * ==========================================================================
   * Configuration
   * ==========================================================================
   */

  validateConfiguration() {
    if (
      !isFiniteNumber(
        this.defaultInterestRate
      ) ||
      this.defaultInterestRate < 0
    ) {
      throw new LoanWorkflowError(
        'defaultInterestRate must be a non-negative number',
        'INVALID_CONFIGURATION'
      );
    }

    if (
      !Number.isInteger(
        this.minTerm
      ) ||
      !Number.isInteger(
        this.maxTerm
      ) ||
      this.minTerm < 1 ||
      this.maxTerm <
        this.minTerm
    ) {
      throw new LoanWorkflowError(
        'Invalid loan term configuration',
        'INVALID_CONFIGURATION'
      );
    }

    if (
      !Number.isInteger(
        this.defaultTerm
      ) ||
      this.defaultTerm <
        this.minTerm ||
      this.defaultTerm >
        this.maxTerm
    ) {
      throw new LoanWorkflowError(
        'defaultTerm is outside configured limits',
        'INVALID_CONFIGURATION'
      );
    }

    if (
      !Number.isInteger(
        this.overdueDaysThreshold
      ) ||
      this.overdueDaysThreshold <
        0
    ) {
      throw new LoanWorkflowError(
        'overdueDaysThreshold must be a non-negative integer',
        'INVALID_CONFIGURATION'
      );
    }

    if (
      !Number.isInteger(
        this.defaultDaysThreshold
      ) ||
      this.defaultDaysThreshold <=
        this.overdueDaysThreshold
    ) {
      throw new LoanWorkflowError(
        'defaultDaysThreshold must be greater than overdueDaysThreshold',
        'INVALID_CONFIGURATION'
      );
    }

    if (
      this.minLoanAmount !== null &&
      (
        !Number.isFinite(
          this.minLoanAmount
        ) ||
        this.minLoanAmount < 0
      )
    ) {
      throw new LoanWorkflowError(
        'Invalid minLoanAmount',
        'INVALID_CONFIGURATION'
      );
    }

    if (
      this.maxLoanAmount !== null &&
      (
        !Number.isFinite(
          this.maxLoanAmount
        ) ||
        this.maxLoanAmount <= 0
      )
    ) {
      throw new LoanWorkflowError(
        'Invalid maxLoanAmount',
        'INVALID_CONFIGURATION'
      );
    }

    if (
      this.minLoanAmount !== null &&
      this.maxLoanAmount !== null &&
      this.minLoanAmount >
        this.maxLoanAmount
    ) {
      throw new LoanWorkflowError(
        'minLoanAmount cannot exceed maxLoanAmount',
        'INVALID_CONFIGURATION'
      );
    }
  }

  /**
   * ==========================================================================
   * State Machine
   * ==========================================================================
   */

  isValidStatus(status) {
    return Boolean(
      this.statusMachine[status]
    );
  }

  canTransition(
    fromStatus,
    toStatus
  ) {
    if (
      !this.isValidStatus(
        fromStatus
      ) ||
      !this.isValidStatus(
        toStatus
      )
    ) {
      return false;
    }

    return this.statusMachine[
      fromStatus
    ].allowedTransitions.includes(
      toStatus
    );
  }

  validateTransition(
    fromStatus,
    toStatus
  ) {
    if (
      !this.isValidStatus(
        fromStatus
      )
    ) {
      throw new LoanWorkflowError(
        `Invalid current status: ${fromStatus}`,
        'INVALID_CURRENT_STATUS'
      );
    }

    if (
      !this.isValidStatus(
        toStatus
      )
    ) {
      throw new LoanWorkflowError(
        `Invalid target status: ${toStatus}`,
        'INVALID_TARGET_STATUS'
      );
    }

    if (
      !this.canTransition(
        fromStatus,
        toStatus
      )
    ) {
      throw new LoanWorkflowError(
        `Invalid transition from '${fromStatus}' to '${toStatus}'`,
        'INVALID_STATUS_TRANSITION',
        {
          fromStatus,
          toStatus,
          allowedTransitions:
            this.statusMachine[
              fromStatus
            ].allowedTransitions,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Create Loan Application
   * ==========================================================================
   */

  async createLoanApplication(
    params = {},
    options = {}
  ) {
    const {
      borrowerId,
      userId,
      memberId,
      groupId,
      tenantId,
      amount,
      term,
      repaymentPeriodMonths,
      description,
      purpose,
    } = params;

    const resolvedUserId =
      userId || borrowerId;

    try {
      normalizeObjectId(
        resolvedUserId,
        'userId'
      );

      normalizeObjectId(
        groupId,
        'groupId'
      );

      if (
        !tenantId ||
        String(tenantId).trim() === ''
      ) {
        throw new LoanWorkflowError(
          'tenantId is required',
          'TENANT_ID_REQUIRED'
        );
      }

      const normalizedAmount =
        normalizePositiveNumber(
          amount,
          'amount'
        );

      const resolvedTerm =
        term !== undefined
          ? term
          : repaymentPeriodMonths !==
              undefined
            ? repaymentPeriodMonths
            : this.defaultTerm;

      const normalizedTerm =
        normalizeInteger(
          resolvedTerm,
          'repaymentPeriodMonths',
          this.minTerm
        );

      if (
        normalizedTerm >
        this.maxTerm
      ) {
        throw new LoanWorkflowError(
          `repaymentPeriodMonths cannot exceed ${this.maxTerm}`,
          'TERM_LIMIT_EXCEEDED'
        );
      }

      if (
        this.minLoanAmount !==
          null &&
        normalizedAmount <
          this.minLoanAmount
      ) {
        throw new LoanWorkflowError(
          `Loan amount must be at least ${this.minLoanAmount}`,
          'LOAN_AMOUNT_TOO_LOW'
        );
      }

      if (
        this.maxLoanAmount !==
          null &&
        normalizedAmount >
          this.maxLoanAmount
      ) {
        throw new LoanWorkflowError(
          `Loan amount cannot exceed ${this.maxLoanAmount}`,
          'LOAN_AMOUNT_TOO_HIGH'
        );
      }

      const now =
        this.clock();

      const payload = {
        tenantId:
          String(tenantId).trim(),

        user:
          resolvedUserId,

        member:
          memberId || undefined,

        group:
          groupId,

        amount:
          roundMoney(
            normalizedAmount
          ),

        interestRate:
          this.defaultInterestRate,

        repaymentPeriodMonths:
          normalizedTerm,

        description,

        purpose,

        status:
          'pending',

        creditDecision:
          'PENDING',

        amountDue:
          roundMoney(
            normalizedAmount
          ),

        amountRepaid: 0,

        outstandingBalance:
          roundMoney(
            normalizedAmount
          ),

        workflowVersion: 1,
      };

      let loan;

      if (options.session) {
        const created =
          await Loan.create(
            [payload],
            {
              session:
                options.session,
            }
          );

        loan = created[0];
      } else {
        loan =
          await Loan.create(
            payload
          );
      }

      await this.createAudit(
        {
          loan: loan._id,
          tenantId:
            loan.tenantId,
          action:
            'loan_application_created',
          actor:
            resolvedUserId,
          actorRole:
            'member',
          reason:
            normalizeReason(
              description
            ),
          after:
            cloneDocument(loan),
          occurredAt: now,
        },
        options
      );

      logger.info(
        '[LoanWorkflowService] Loan application created',
        {
          loanId:
            String(loan._id),
          tenantId:
            String(loan.tenantId),
          userId:
            String(resolvedUserId),
          amount:
            loan.amount,
          status:
            loan.status,
        }
      );

      return loan;
    } catch (error) {
      logger.error(
        '[LoanWorkflowService] Error creating loan application',
        {
          error:
            error.message,
          code:
            error.code,
          userId:
            resolvedUserId,
          groupId,
          tenantId,
          amount,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Change Loan Status
   * ==========================================================================
   */

  async changeLoanStatus(
    loanId,
    newStatus,
    actor,
    reason = '',
    options = {}
  ) {
    const normalizedActor =
      normalizeActor(actor);

    const normalizedReason =
      normalizeReason(reason);

    try {
      normalizeObjectId(
        loanId,
        'loanId'
      );

      if (
        !this.isValidStatus(
          newStatus
        )
      ) {
        throw new LoanWorkflowError(
          `Invalid target status: ${newStatus}`,
          'INVALID_TARGET_STATUS'
        );
      }

      const query =
        Loan.findById(loanId);

      if (options.session) {
        query.session(
          options.session
        );
      }

      const loan =
        await query;

      if (!loan) {
        throw new LoanWorkflowError(
          'Loan not found',
          'LOAN_NOT_FOUND'
        );
      }

      if (
        options.tenantId &&
        String(
          loan.tenantId
        ) !==
          String(
            options.tenantId
          )
      ) {
        throw new LoanWorkflowError(
          'Loan does not belong to the requested tenant',
          'TENANT_ACCESS_DENIED'
        );
      }

      const currentStatus =
        loan.status;

      this.validateTransition(
        currentStatus,
        newStatus
      );

      const before =
        cloneDocument(loan);

      const timestamp =
        this.clock();

      /**
       * ------------------------------------------------------------------------
       * Lifecycle prerequisites
       * ------------------------------------------------------------------------
       */

      if (
        newStatus ===
        'approved'
      ) {
        if (
          loan.creditDecision ===
          'REJECTED'
        ) {
          throw new LoanWorkflowError(
            'Rejected loan cannot be approved without a new credit decision',
            'CREDIT_DECISION_BLOCKS_APPROVAL'
          );
        }

        if (
          !loan.kycVerified
        ) {
          throw new LoanWorkflowError(
            'Loan cannot be approved before KYC verification',
            'KYC_REQUIRED'
          );
        }

        if (
          !loan.amlChecked
        ) {
          throw new LoanWorkflowError(
            'Loan cannot be approved before AML verification',
            'AML_CHECK_REQUIRED'
          );
        }

        if (
          loan.fraudFlagged
        ) {
          throw new LoanWorkflowError(
            'Fraud-flagged loan cannot be approved',
            'FRAUD_REVIEW_REQUIRED'
          );
        }

        if (
          loan.approvedAt
        ) {
          throw new LoanWorkflowError(
            'Loan has already been approved',
            'LOAN_ALREADY_APPROVED'
          );
        }
      }

      if (
        newStatus ===
        'disbursed'
      ) {
        if (
          !loan.approvedAt
        ) {
          throw new LoanWorkflowError(
            'Loan cannot be disbursed before approval',
            'APPROVAL_REQUIRED'
          );
        }

        if (
          !loan.approvedBy
        ) {
          throw new LoanWorkflowError(
            'Loan approval actor is missing',
            'APPROVAL_ACTOR_REQUIRED'
          );
        }

        if (
          !loan.disbursementMethod
        ) {
          throw new LoanWorkflowError(
            'Disbursement method is required',
            'DISBURSEMENT_METHOD_REQUIRED'
          );
        }

        if (
          !loan.disbursedAmount ||
          Number(
            loan.disbursedAmount
          ) <= 0
        ) {
          throw new LoanWorkflowError(
            'Disbursed amount must be recorded before disbursement state',
            'DISBURSED_AMOUNT_REQUIRED'
          );
        }
      }

      if (
        newStatus === 'active'
      ) {
        if (
          !loan.disbursedAt
        ) {
          throw new LoanWorkflowError(
            'Loan cannot become active before disbursement',
            'DISBURSEMENT_REQUIRED'
          );
        }

        await this.ensureRepaymentSchedule(
          loan,
          options
        );
      }

      if (
        newStatus ===
        'defaulted'
      ) {
        if (
          loan.status !==
            'active' &&
          loan.status !==
            'restructured'
        ) {
          throw new LoanWorkflowError(
            'Only active or restructured loans can enter default',
            'INVALID_DEFAULT_TRANSITION'
          );
        }
      }

      /**
       * ------------------------------------------------------------------------
       * Apply lifecycle state
       * ------------------------------------------------------------------------
       */

      loan.status =
        newStatus;

      if (
        newStatus ===
        'approved'
      ) {
        loan.approvedAt =
          loan.approvedAt ||
          timestamp;

        loan.approvedBy =
          loan.approvedBy ||
          normalizedActor.id;

        loan.creditDecision =
          'APPROVED';

        loan.creditDecisionDate =
          timestamp;
      }

      if (
        newStatus ===
        'rejected'
      ) {
        loan.rejectedAt =
          timestamp;

        loan.creditDecision =
          'REJECTED';

        loan.creditDecisionDate =
          timestamp;
      }

      if (
        newStatus ===
        'disbursed'
      ) {
        loan.disbursedAt =
          timestamp;

        loan.disbursedAmount =
          roundMoney(
            loan.disbursedAmount ||
              loan.amount
          );
      }

      if (
        newStatus ===
        'completed'
      ) {
        loan.completedAt =
          timestamp;

        loan.outstandingBalance =
          0;

        loan.amountRepaid =
          roundMoney(
            Math.max(
              Number(
                loan.amountRepaid ||
                  0
              ),
              Number(
                loan.amountDue ||
                  loan.amount
              )
            )
          );
      }

      if (
        newStatus ===
        'cancelled'
      ) {
        loan.cancelledAt =
          timestamp;
      }

      if (
        newStatus ===
        'defaulted'
      ) {
        loan.defaultedAt =
          loan.defaultedAt ||
          timestamp;
      }

      if (
        newStatus ===
        'written_off'
      ) {
        loan.writtenOffAt =
          loan.writtenOffAt ||
          timestamp;
      }

      if (
        newStatus ===
        'recovered'
      ) {
        loan.recoveredAt =
          loan.recoveredAt ||
          timestamp;
      }

      if (
        newStatus ===
        'restructured'
      ) {
        loan.restructuredAt =
          loan.restructuredAt ||
          timestamp;
      }

      /**
       * Never allow persisted monetary fields to become negative.
       */
      loan.amountDue =
        Math.max(
          0,
          roundMoney(
            loan.amountDue ||
              loan.amount
          )
        );

      loan.amountRepaid =
        Math.max(
          0,
          roundMoney(
            loan.amountRepaid || 0
          )
        );

      loan.outstandingBalance =
        Math.max(
          0,
          roundMoney(
            loan.amountDue -
              loan.amountRepaid
          )
        );

      if (
        newStatus ===
        'completed'
      ) {
        loan.outstandingBalance =
          0;
      }

      /**
       * Do not invent fields not present in the Loan schema.
       */
      if (
        options.session
      ) {
        await loan.save({
          session:
            options.session,
        });
      } else {
        await loan.save();
      }

      await this.createAudit(
        {
          loan: loan._id,
          tenantId:
            loan.tenantId,
          action:
            'status_change',
          oldStatus:
            currentStatus,
          newStatus,
          actor:
            normalizedActor.id,
          actorRole:
            normalizedActor.role,
          reason:
            normalizedReason,
          before,
          after:
            cloneDocument(loan),
          occurredAt:
            timestamp,
        },
        options
      );

      logger.info(
        '[LoanWorkflowService] Loan status changed',
        {
          loanId:
            String(loan._id),
          tenantId:
            String(loan.tenantId),
          oldStatus:
            currentStatus,
          newStatus,
          actor:
            normalizedActor.id,
        }
      );

      return loan;
    } catch (error) {
      logger.error(
        '[LoanWorkflowService] Error changing loan status',
        {
          error:
            error.message,
          code:
            error.code,
          loanId,
          newStatus,
          actor:
            normalizedActor.id,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Repayment Schedule
   * ==========================================================================
   */

  async ensureRepaymentSchedule(
    loan,
    options = {}
  ) {
    if (
      !loan ||
      !loan._id
    ) {
      throw new LoanWorkflowError(
        'Valid loan document is required',
        'LOAN_REQUIRED'
      );
    }

    const query =
      LoanRepaymentSchedule.findOne({
        loan: loan._id,
      });

    if (options.session) {
      query.session(
        options.session
      );
    }

    const existing =
      await query;

    if (existing) {
      return existing;
    }

    return this.generateRepaymentSchedule(
      loan,
      options
    );
  }

  async generateRepaymentSchedule(
    loan,
    options = {}
  ) {
    try {
      if (
        !loan ||
        !loan._id
      ) {
        throw new LoanWorkflowError(
          'Valid loan document is required',
          'LOAN_REQUIRED'
        );
      }

      const principal =
        normalizePositiveNumber(
          loan.amount,
          'loan.amount'
        );

      const term =
        normalizeInteger(
          loan.repaymentPeriodMonths,
          'loan.repaymentPeriodMonths',
          1
        );

      const annualRate =
        normalizeNonNegativeNumber(
          loan.interestRate || 0,
          'loan.interestRate'
        );

      const monthlyRate =
        annualRate / 12;

      const payment =
        this.calculateMonthlyPayment(
          principal,
          monthlyRate,
          term
        );

      let outstandingMinor =
        toMinorUnits(
          principal
        );

      let totalInterestMinor =
        0;

      let totalAmountMinor =
        0;

      const installments =
        [];

      const startDate =
        loan.disbursedAt
          ? safeDate(
              loan.disbursedAt,
              'loan.disbursedAt'
            )
          : safeDate(
              this.clock(),
              'current date'
            );

      for (
        let installmentNumber = 1;
        installmentNumber <= term;
        installmentNumber += 1
      ) {
        const dueDate =
          new Date(startDate);

        dueDate.setMonth(
          dueDate.getMonth() +
            installmentNumber
        );

        const interestMinor =
          monthlyRate === 0
            ? 0
            : Math.round(
                outstandingMinor *
                  monthlyRate
              );

        let principalMinor;

        if (
          installmentNumber ===
          term
        ) {
          principalMinor =
            outstandingMinor;
        } else {
          principalMinor =
            Math.max(
              0,
              toMinorUnits(
                payment
              ) -
                interestMinor
            );

          principalMinor =
            Math.min(
              principalMinor,
              outstandingMinor
            );
        }

        const totalMinor =
          principalMinor +
          interestMinor;

        outstandingMinor =
          Math.max(
            0,
            outstandingMinor -
              principalMinor
          );

        totalInterestMinor +=
          interestMinor;

        totalAmountMinor +=
          totalMinor;

        /**
         * These fields target the existing schedule contract used
         * by the workflow service.
         *
         * If LoanRepaymentSchedule uses a different schema, its schema
         * must be aligned rather than silently accepting incompatible data.
         */
        installments.push({
          installmentNumber,

          dueDate,

          principalAmount:
            fromMinorUnits(
              principalMinor
            ),

          interestAmount:
            fromMinorUnits(
              interestMinor
            ),

          totalAmount:
            fromMinorUnits(
              totalMinor
            ),

          status: 'pending',

          paidAmount: 0,

          paidDate: null,

          daysOverdue: 0,
        });
      }

      const payload = {
        loan:
          loan._id,

        totalInstallments:
          installments.length,

        monthlyPayment:
          roundMoney(payment),

        totalAmount:
          fromMinorUnits(
            totalAmountMinor
          ),

        totalInterest:
          fromMinorUnits(
            totalInterestMinor
          ),

        installments,

        generatedAt:
          this.clock(),
      };

      let schedule;

      if (options.session) {
        const created =
          await LoanRepaymentSchedule.create(
            [payload],
            {
              session:
                options.session,
            }
          );

        schedule =
          created[0];
      } else {
        schedule =
          await LoanRepaymentSchedule.create(
            payload
          );
      }

      logger.info(
        '[LoanWorkflowService] Repayment schedule generated',
        {
          loanId:
            String(loan._id),
          totalInstallments:
            schedule.totalInstallments,
          monthlyPayment:
            schedule.monthlyPayment,
        }
      );

      return schedule;
    } catch (error) {
      logger.error(
        '[LoanWorkflowService] Error generating repayment schedule',
        {
          error:
            error.message,
          code:
            error.code,
          loanId:
            loan?._id,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Record Repayment
   * ==========================================================================
   */

  async recordRepayment(
    loanId,
    amount,
    transactionId,
    options = {}
  ) {
    try {
      normalizeObjectId(
        loanId,
        'loanId'
      );

      const paymentAmount =
        normalizePositiveNumber(
          amount,
          'amount'
        );

      if (
        transactionId ===
          undefined ||
        transactionId ===
          null ||
        String(
          transactionId
        ).trim() === ''
      ) {
        throw new LoanWorkflowError(
          'transactionId is required',
          'TRANSACTION_ID_REQUIRED'
        );
      }

      const normalizedTransactionId =
        String(
          transactionId
        ).trim();

      /**
       * Tenant isolation.
       */
      const loanQuery =
        Loan.findById(
          loanId
        );

      if (options.session) {
        loanQuery.session(
          options.session
        );
      }

      const loan =
        await loanQuery;

      if (!loan) {
        throw new LoanWorkflowError(
          'Loan not found',
          'LOAN_NOT_FOUND'
        );
      }

      if (
        options.tenantId &&
        String(
          loan.tenantId
        ) !==
          String(
            options.tenantId
          )
      ) {
        throw new LoanWorkflowError(
          'Loan does not belong to the requested tenant',
          'TENANT_ACCESS_DENIED'
        );
      }

      /**
       * Idempotency lookup.
       *
       * A UNIQUE index on transactionId + tenant/loan should additionally
       * be created at the LoanAudit schema level for true concurrency safety.
       */
      const duplicateQuery =
        LoanAudit.findOne({
          loan: loanId,
          action:
            'repayment_recorded',
          transactionId:
            normalizedTransactionId,
        });

      if (options.session) {
        duplicateQuery.session(
          options.session
        );
      }

      const existingAudit =
        await duplicateQuery;

      if (existingAudit) {
        const scheduleQuery =
          LoanRepaymentSchedule.findOne(
            {
              loan: loanId,
            }
          );

        if (options.session) {
          scheduleQuery.session(
            options.session
          );
        }

        return {
          loan,
          schedule:
            await scheduleQuery,
          idempotent: true,
          transactionId:
            normalizedTransactionId,
        };
      }

      if (
        ![
          'active',
          'defaulted',
          'restructured',
        ].includes(
          loan.status
        )
      ) {
        throw new LoanWorkflowError(
          `Cannot record repayment for loan with status '${loan.status}'`,
          'LOAN_NOT_REPAYABLE'
        );
      }

      const scheduleQuery =
        LoanRepaymentSchedule.findOne(
          {
            loan: loanId,
          }
        );

      if (options.session) {
        scheduleQuery.session(
          options.session
        );
      }

      const schedule =
        await scheduleQuery;

      if (!schedule) {
        throw new LoanWorkflowError(
          'Repayment schedule not found',
          'REPAYMENT_SCHEDULE_NOT_FOUND'
        );
      }

      if (
        !Array.isArray(
          schedule.installments
        ) ||
        schedule.installments.length ===
          0
      ) {
        throw new LoanWorkflowError(
          'Repayment schedule contains no installments',
          'INVALID_REPAYMENT_SCHEDULE'
        );
      }

      let remainingMinor =
        toMinorUnits(
          paymentAmount
        );

      let appliedMinor = 0;

      const affectedInstallments =
        [];

      const paymentDate =
        this.clock();

      const pendingInstallments =
        schedule.installments
          .filter(
            (installment) =>
              installment.status !==
              'paid'
          )
          .sort(
            (a, b) =>
              Number(
                a.installmentNumber
              ) -
              Number(
                b.installmentNumber
              )
          );

      if (
        pendingInstallments.length ===
        0
      ) {
        throw new LoanWorkflowError(
          'No pending installments found',
          'NO_PENDING_INSTALLMENTS'
        );
      }

      for (
        const installment of
        pendingInstallments
      ) {
        if (
          remainingMinor <= 0
        ) {
          break;
        }

        const totalMinor =
          toMinorUnits(
            installment.totalAmount
          );

        const paidMinor =
          toMinorUnits(
            installment.paidAmount ||
              0
          );

        const outstandingMinor =
          Math.max(
            0,
            totalMinor -
              paidMinor
          );

        if (
          outstandingMinor === 0
        ) {
          installment.status =
            'paid';

          continue;
        }

        const allocationMinor =
          Math.min(
            remainingMinor,
            outstandingMinor
          );

        const newPaidMinor =
          paidMinor +
          allocationMinor;

        installment.paidAmount =
          fromMinorUnits(
            newPaidMinor
          );

        installment.daysOverdue =
          calculateDaysOverdue(
            installment.dueDate,
            paymentDate
          );

        if (
          newPaidMinor >=
          totalMinor
        ) {
          installment.status =
            'paid';

          installment.paidDate =
            paymentDate;
        } else {
          installment.status =
            'pending';

          installment.paidDate =
            null;
        }

        remainingMinor -=
          allocationMinor;

        appliedMinor +=
          allocationMinor;

        affectedInstallments.push(
          {
            installmentNumber:
              installment.installmentNumber,

            amount:
              fromMinorUnits(
                allocationMinor
              ),

            status:
              installment.status,

            daysOverdue:
              installment.daysOverdue,
          }
        );
      }

      if (
        appliedMinor <= 0
      ) {
        throw new LoanWorkflowError(
          'Payment could not be allocated',
          'PAYMENT_NOT_ALLOCATED'
        );
      }

      const appliedAmount =
        fromMinorUnits(
          appliedMinor
        );

      const unappliedAmount =
        fromMinorUnits(
          remainingMinor
        );

      const currentAmountRepaid =
        Math.max(
          0,
          roundMoney(
            loan.amountRepaid ||
              0
          )
        );

      const currentAmountDue =
        Math.max(
          0,
          roundMoney(
            loan.amountDue ||
              loan.amount
          )
        );

      const newAmountRepaid =
        roundMoney(
          currentAmountRepaid +
            appliedAmount
        );

      const newOutstandingBalance =
        Math.max(
          0,
          roundMoney(
            currentAmountDue -
              newAmountRepaid
          )
        );

      loan.amountRepaid =
        newAmountRepaid;

      loan.amountDue =
        currentAmountDue;

      loan.outstandingBalance =
        newOutstandingBalance;

      loan.lastPaymentDate =
        paymentDate;

      if (
        !loan.firstPaymentDate
      ) {
        loan.firstPaymentDate =
          paymentDate;
      }

      loan.lastRepaymentAmount =
        appliedAmount;

      /**
       * Determine next payment date.
       */
      const nextInstallment =
        schedule.installments
          .filter(
            (installment) =>
              installment.status !==
              'paid'
          )
          .sort(
            (a, b) =>
              Number(
                a.installmentNumber
              ) -
              Number(
                b.installmentNumber
              )
          )[0];

      loan.nextPaymentDate =
        nextInstallment
          ? nextInstallment.dueDate
          : null;

      const allPaid =
        schedule.installments.every(
          (installment) =>
            installment.status ===
            'paid'
        );

      let targetStatus =
        loan.status;

      if (
        allPaid ||
        newOutstandingBalance === 0
      ) {
        targetStatus =
          'completed';
      } else if (
        nextInstallment
      ) {
        const daysOverdue =
          calculateDaysOverdue(
            nextInstallment.dueDate,
            paymentDate
          );

        if (
          daysOverdue >
          this.defaultDaysThreshold
        ) {
          targetStatus =
            'defaulted';
        } else {
          targetStatus =
            loan.status ===
            'defaulted'
              ? 'defaulted'
              : loan.status ===
                  'restructured'
                ? 'restructured'
                : 'active';
        }
      }

      /**
       * Persist schedule first.
       */
      if (options.session) {
        await schedule.save({
          session:
            options.session,
        });
      } else {
        await schedule.save();
      }

      /**
       * Lifecycle update.
       */
      const oldStatus =
        loan.status;

      if (
        targetStatus !==
        oldStatus
      ) {
        this.validateTransition(
          oldStatus,
          targetStatus
        );

        loan.status =
          targetStatus;

        if (
          targetStatus ===
          'completed'
        ) {
          loan.completedAt =
            paymentDate;

          loan.outstandingBalance =
            0;
        }

        if (
          targetStatus ===
          'defaulted'
        ) {
          loan.defaultedAt =
            loan.defaultedAt ||
            paymentDate;
        }

        await this.createAudit(
          {
            loan:
              loan._id,

            tenantId:
              loan.tenantId,

            action:
              'status_change',

            oldStatus,

            newStatus:
              targetStatus,

            actor:
              SYSTEM_ACTOR.id,

            actorRole:
              SYSTEM_ACTOR.role,

            reason:
              targetStatus ===
              'completed'
                ? 'Loan fully repaid'
                : 'Loan status recalculated after repayment',

            before: {
              status:
                oldStatus,

              outstandingBalance:
                currentAmountDue -
                currentAmountRepaid,
            },

            after: {
              status:
                targetStatus,

              outstandingBalance:
                loan.outstandingBalance,
            },

            occurredAt:
              paymentDate,
          },
          options
        );
      }

      if (options.session) {
        await loan.save({
          session:
            options.session,
        });
      } else {
        await loan.save();
      }

      /**
       * Repayment audit.
       */
      await this.createAudit(
        {
          loan:
            loan._id,

          tenantId:
            loan.tenantId,

          action:
            'repayment_recorded',

          amount:
            appliedAmount,

          transactionId:
            normalizedTransactionId,

          installmentNumber:
            affectedInstallments[0]
              ?.installmentNumber,

          affectedInstallments,

          unappliedAmount,

          actor:
            SYSTEM_ACTOR.id,

          actorRole:
            SYSTEM_ACTOR.role,

          occurredAt:
            paymentDate,
        },
        options
      );

      logger.info(
        '[LoanWorkflowService] Repayment recorded',
        {
          loanId:
            String(loanId),

          tenantId:
            String(loan.tenantId),

          amount:
            appliedAmount,

          unappliedAmount,

          outstandingBalance:
            loan.outstandingBalance,

          transactionId:
            normalizedTransactionId,
        }
      );

      return {
        loan,

        schedule,

        idempotent:
          false,

        transactionId:
          normalizedTransactionId,

        appliedAmount,

        unappliedAmount,

        affectedInstallments,
      };
    } catch (error) {
      logger.error(
        '[LoanWorkflowService] Error recording repayment',
        {
          error:
            error.message,

          code:
            error.code,

          loanId,

          amount,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Overdue / Default Processing
   * ==========================================================================
   */

  async checkAndUpdateOverdueStatus(
    options = {}
  ) {
    const stats = {
      checked: 0,
      updated: 0,
      overdue: 0,
      defaulted: 0,
      closed: 0,
      missingSchedules: 0,
      errors: 0,
    };

    const now =
      options.now
        ? safeDate(
            options.now,
            'options.now'
          )
        : this.clock();

    try {
      const filter = {
        status: {
          $in: [
            'active',
            'defaulted',
            'restructured',
          ],
        },
      };

      if (
        options.tenantId
      ) {
        filter.tenantId =
          String(
            options.tenantId
          );
      }

      const query =
        Loan.find(filter);

      if (options.limit) {
        query.limit(
          normalizeInteger(
            options.limit,
            'limit',
            1
          )
        );
      }

      if (options.session) {
        query.session(
          options.session
        );
      }

      const loans =
        await query;

      for (
        const loan of loans
      ) {
        stats.checked += 1;

        try {
          const scheduleQuery =
            LoanRepaymentSchedule.findOne(
              {
                loan:
                  loan._id,
              }
            );

          if (options.session) {
            scheduleQuery.session(
              options.session
            );
          }

          const schedule =
            await scheduleQuery;

          if (!schedule) {
            stats.missingSchedules +=
              1;

            continue;
          }

          if (
            !Array.isArray(
              schedule.installments
            )
          ) {
            stats.errors += 1;
            continue;
          }

          const pendingInstallments =
            schedule.installments
              .filter(
                (installment) =>
                  installment.status !==
                  'paid'
              )
              .sort(
                (a, b) =>
                  Number(
                    a.installmentNumber
                  ) -
                  Number(
                    b.installmentNumber
                  )
              );

          if (
            pendingInstallments.length ===
            0
          ) {
            if (
              loan.status !==
              'completed'
            ) {
              await this.changeLoanStatus(
                loan._id,
                'completed',
                SYSTEM_ACTOR,
                'Automated closure: all installments paid',
                options
              );

              stats.updated += 1;
              stats.closed += 1;
            }

            continue;
          }

          let maximumDaysOverdue =
            0;

          let changed =
            false;

          for (
            const installment of
              pendingInstallments
          ) {
            const daysOverdue =
              calculateDaysOverdue(
                installment.dueDate,
                now
              );

            if (
              installment.daysOverdue !==
              daysOverdue
            ) {
              installment.daysOverdue =
                daysOverdue;

              changed = true;
            }

            maximumDaysOverdue =
              Math.max(
                maximumDaysOverdue,
                daysOverdue
              );
          }

          if (changed) {
            if (options.session) {
              await schedule.save({
                session:
                  options.session,
              });
            } else {
              await schedule.save();
            }
          }

          /**
           * Keep Loan-level DPD synchronized.
           */
          if (
            loan.daysPastDue !==
            maximumDaysOverdue
          ) {
            loan.daysPastDue =
              maximumDaysOverdue;

            if (options.session) {
              await loan.save({
                session:
                  options.session,
              });
            } else {
              await loan.save();
            }
          }

          let targetStatus =
            null;

          if (
            maximumDaysOverdue >
            this.defaultDaysThreshold
          ) {
            targetStatus =
              'defaulted';
          } else if (
            maximumDaysOverdue >
            this.overdueDaysThreshold
          ) {
            /**
             * The supplied Loan schema has no "overdue" status.
             *
             * Therefore overdue is represented by:
             *   - active status
             *   - daysPastDue
             *   - parBucket
             *
             * We intentionally do NOT invent an invalid status.
             */
            if (
              loan.status !==
              'defaulted'
            ) {
              targetStatus =
                'active';
            }
          } else if (
            loan.status ===
              'defaulted' &&
            maximumDaysOverdue <=
              this.overdueDaysThreshold
          ) {
            /**
             * A defaulted loan must not automatically recover merely because
             * the DPD calculation changed. Default recovery requires an
             * explicit business decision/payment/restructuring workflow.
             */
            targetStatus =
              null;
          }

          if (
            targetStatus &&
            targetStatus !==
              loan.status
          ) {
            if (
              !this.canTransition(
                loan.status,
                targetStatus
              )
            ) {
              continue;
            }

            await this.changeLoanStatus(
              loan._id,
              targetStatus,
              SYSTEM_ACTOR,
              `Automated loan status update: ${targetStatus}`,
              options
            );

            stats.updated += 1;
          }

          if (
            maximumDaysOverdue >
            this.defaultDaysThreshold &&
            loan.status !==
              'defaulted'
          ) {
            if (
              this.canTransition(
                loan.status,
                'defaulted'
              )
            ) {
              await this.changeLoanStatus(
                loan._id,
                'defaulted',
                SYSTEM_ACTOR,
                'Automated default classification',
                options
              );

              stats.updated += 1;
              stats.defaulted += 1;
            }
          }
        } catch (error) {
          stats.errors += 1;

          logger.error(
            '[LoanWorkflowService] Error processing overdue loan',
            {
              error:
                error.message,
              code:
                error.code,
              loanId:
                String(
                  loan._id
                ),
            }
          );
        }
      }

      logger.info(
        '[LoanWorkflowService] Overdue check completed',
        stats
      );

      return stats;
    } catch (error) {
      logger.error(
        '[LoanWorkflowService] Error checking overdue status',
        {
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
   * Loan Summary
   * ==========================================================================
   */

  async getLoanSummary(
    loanId,
    options = {}
  ) {
    try {
      normalizeObjectId(
        loanId,
        'loanId'
      );

      const loanQuery =
        Loan.findById(
          loanId
        );

      if (options.session) {
        loanQuery.session(
          options.session
        );
      }

      const loan =
        await loanQuery;

      if (!loan) {
        throw new LoanWorkflowError(
          'Loan not found',
          'LOAN_NOT_FOUND'
        );
      }

      if (
        options.tenantId &&
        String(
          loan.tenantId
        ) !==
          String(
            options.tenantId
          )
      ) {
        throw new LoanWorkflowError(
          'Loan does not belong to the requested tenant',
          'TENANT_ACCESS_DENIED'
        );
      }

      const scheduleQuery =
        LoanRepaymentSchedule.findOne(
          {
            loan:
              loanId,
          }
        );

      if (options.session) {
        scheduleQuery.session(
          options.session
        );
      }

      const schedule =
        await scheduleQuery;

      if (!schedule) {
        throw new LoanWorkflowError(
          'Repayment schedule not found',
          'REPAYMENT_SCHEDULE_NOT_FOUND'
        );
      }

      const installments =
        Array.isArray(
          schedule.installments
        )
          ? schedule.installments
          : [];

      const paidInstallments =
        installments.filter(
          (installment) =>
            installment.status ===
            'paid'
        );

      const pendingInstallments =
        installments.filter(
          (installment) =>
            installment.status !==
            'paid'
        );

      const totalInstallments =
        Number(
          schedule.totalInstallments
        ) ||
        installments.length;

      const paidCount =
        paidInstallments.length;

      const percentComplete =
        totalInstallments > 0
          ? roundMoney(
              (
                paidCount /
                totalInstallments
              ) *
                100
            )
          : 0;

      const outstandingBalance =
        Math.max(
          0,
          roundMoney(
            loan.outstandingBalance ||
              0
          )
        );

      return {
        loanId:
          loan._id,

        tenantId:
          loan.tenantId,

        user:
          loan.user,

        member:
          loan.member,

        group:
          loan.group,

        amount:
          loan.amount,

        term:
          loan.repaymentPeriodMonths,

        repaymentPeriodMonths:
          loan.repaymentPeriodMonths,

        status:
          loan.status,

        interestRate:
          loan.interestRate,

        purpose:
          loan.purpose,

        appliedAt:
          loan.createdAt,

        approvedAt:
          loan.approvedAt,

        disbursedAt:
          loan.disbursedAt,

        completedAt:
          loan.completedAt,

        cancelledAt:
          loan.cancelledAt,

        defaultedAt:
          loan.defaultedAt,

        repaymentSchedule: {
          monthlyPayment:
            schedule.monthlyPayment,

          totalPayable:
            schedule.totalAmount,

          totalInterest:
            schedule.totalInterest,

          totalInstallments,

          paidInstallments:
            paidCount,

          pendingInstallments:
            pendingInstallments.length,

          nextInstallmentDue:
            pendingInstallments[0]
              ?.dueDate,

          outstandingBalance,
        },

        progress: {
          percentComplete,

          amountPaid:
            roundMoney(
              loan.amountRepaid ||
                0
            ),

          amountRemaining:
            outstandingBalance,

          daysPastDue:
            loan.daysPastDue || 0,

          parBucket:
            loan.parBucket,
        },
      };
    } catch (error) {
      logger.error(
        '[LoanWorkflowService] Error getting loan summary',
        {
          error:
            error.message,
          code:
            error.code,
          loanId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Amortization
   * ==========================================================================
   */

  calculateMonthlyPayment(
    principal,
    monthlyRate,
    term
  ) {
    const normalizedPrincipal =
      normalizePositiveNumber(
        principal,
        'principal'
      );

    const normalizedRate =
      normalizeNonNegativeNumber(
        monthlyRate,
        'monthlyRate'
      );

    const normalizedTerm =
      normalizeInteger(
        term,
        'term',
        1
      );

    if (
      normalizedRate === 0
    ) {
      return roundMoney(
        normalizedPrincipal /
          normalizedTerm
      );
    }

    const factor =
      Math.pow(
        1 + normalizedRate,
        normalizedTerm
      );

    if (
      !Number.isFinite(
        factor
      )
    ) {
      throw new LoanWorkflowError(
        'Unable to calculate monthly payment',
        'AMORTIZATION_CALCULATION_ERROR'
      );
    }

    const denominator =
      factor - 1;

    if (
      denominator === 0
    ) {
      throw new LoanWorkflowError(
        'Invalid amortization denominator',
        'AMORTIZATION_CALCULATION_ERROR'
      );
    }

    const payment =
      (
        normalizedPrincipal *
        normalizedRate *
        factor
      ) /
      denominator;

    return roundMoney(
      payment
    );
  }

  /**
   * ==========================================================================
   * Audit
   * ==========================================================================
   */

  async createAudit(
    data,
    options = {}
  ) {
    if (
      !data ||
      !data.loan
    ) {
      throw new LoanWorkflowError(
        'Audit loan reference is required',
        'AUDIT_LOAN_REQUIRED'
      );
    }

    const payload = {
      ...data,
    };

    if (
      payload.before
    ) {
      payload.before =
        cloneDocument(
          payload.before
        );
    }

    if (
      payload.after
    ) {
      payload.after =
        cloneDocument(
          payload.after
        );
    }

    if (
      options.session
    ) {
      const created =
        await LoanAudit.create(
          [payload],
          {
            session:
              options.session,
          }
        );

      return created[0];
    }

    return LoanAudit.create(
      payload
    );
  }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
  LoanWorkflowService;

module.exports.LoanWorkflowError =
  LoanWorkflowError;

module.exports.LOAN_STATUS_MACHINE =
  LOAN_STATUS_MACHINE;

module.exports.SYSTEM_ACTOR =
  SYSTEM_ACTOR;

module.exports.roundMoney =
  roundMoney;