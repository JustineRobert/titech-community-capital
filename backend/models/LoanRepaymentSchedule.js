// backend/models/LoanRepaymentSchedule.js
// ============================================================================
// TITech Community Capital LTD
// Loan Repayment Schedule Model
// ============================================================================
//
// Responsibilities
//   - Maintain the contractual repayment schedule for a loan.
//   - Track installment-level repayment allocation.
//   - Track schedule-level penalties and outstanding amounts.
//   - Provide deterministic schedule calculations and read helpers.
//
// IMPORTANT FINANCIAL BOUNDARY
//   This model does NOT post accounting entries, mutate wallet balances, or
//   perform payment settlement. Financial transactions must be authorized by
//   the application/service layer and persisted within the appropriate MongoDB
//   transaction/session boundary.
//
// Compatibility
//   - ESM module format.
//   - Keeps monetary values as Numbers for compatibility with the existing
//     application. Financial service-layer code must validate finite values and
//     apply currency-appropriate precision before persistence.
//   - Keeps Mongoose versioning (__v) enabled for optimistic concurrency.
//
// ============================================================================

import mongoose from 'mongoose';

const { Schema } = mongoose;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONEY_EPSILON = 1e-9;

const INSTALLMENT_STATUSES = Object.freeze([
  'pending',
  'partially_paid',
  'paid',
  'overdue',
  'forgiven',
]);

const SCHEDULE_STATUSES = Object.freeze([
  'active',
  'completed',
  'defaulted',
  'suspended',
]);

const PAYMENT_METHODS = Object.freeze([
  'mtn_momo',
  'airtel_money',
  'bank',
  'cash',
  'internal',
  'other',
]);

const isFiniteNonNegative = (value) =>
  Number.isFinite(value) && value >= 0;

const isPositiveFinite = (value) =>
  Number.isFinite(value) && value > 0;

const roundMoney = (value) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeMoney = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new TypeError(`Invalid monetary value: ${value}`);
  }

  if (number < 0) {
    throw new RangeError(`Monetary value cannot be negative: ${value}`);
  }

  return roundMoney(number);
};

const outstandingForInstallment = (installment) =>
  Math.max(
    0,
    roundMoney(
      installment.totalAmount -
        installment.paidAmount +
        installment.penalties
    )
  );

const isTerminalInstallment = (installment) =>
  ['paid', 'forgiven'].includes(installment.status);

const areAllInstallmentsComplete = (installments) =>
  installments.length > 0 &&
  installments.every(isTerminalInstallment);

/**
 * Embedded payment allocation.
 *
 * `_id: false` intentionally keeps this as a child allocation rather than
 * treating it as a standalone financial transaction.
 */
const repaymentPaymentSchema = new Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0.01,
      validate: {
        validator: isPositiveFinite,
        message: 'Payment amount must be a finite value greater than zero.',
      },
    },

    paidAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    method: {
      type: String,
      required: true,
      enum: PAYMENT_METHODS,
      lowercase: true,
      trim: true,
    },

    /**
     * Reference supplied by the payment/financial transaction layer.
     * This must be stable enough to support idempotency.
     */
    reference: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 150,
    },

    /**
     * Optional external/provider reference, e.g. MoMo/Airtel/bank reference.
     */
    providerReference: {
      type: String,
      trim: true,
      maxlength: 150,
    },

    /**
     * Canonical financial transaction identifier.
     * The schedule records the allocation; the Transaction model remains the
     * source of truth for settlement/accounting state.
     */
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
    },
  },
  {
    _id: false,
    id: false,
  }
);

const installmentSchema = new Schema(
  {
    number: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'Installment number must be an integer.',
      },
    },

    dueDate: {
      type: Date,
      required: true,
    },

    principal: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'Principal must be a finite non-negative amount.',
      },
    },

    interest: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'Interest must be a finite non-negative amount.',
      },
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'Total installment amount must be a finite non-negative amount.',
      },
    },

    paidAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'Paid amount must be a finite non-negative amount.',
      },
    },

    penalties: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'Penalty amount must be a finite non-negative amount.',
      },
    },

    status: {
      type: String,
      required: true,
      enum: INSTALLMENT_STATUSES,
      default: 'pending',
      lowercase: true,
      trim: true,
    },

    paidAt: {
      type: Date,
    },

    payments: {
      type: [repaymentPaymentSchema],
      default: [],
    },

    forgivenAt: {
      type: Date,
    },

    forgivenessReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    _id: true,
    id: true,
  }
);

const loanRepaymentScheduleSchema = new Schema(
  {
    /**
     * Tenant isolation is mandatory for all financial records.
     */
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * A loan has exactly one active contractual repayment schedule in this
     * model.
     */
    loan: {
      type: Schema.Types.ObjectId,
      ref: 'Loan',
      required: true,
      immutable: true,
      index: true,
    },

    installments: {
      type: [installmentSchema],
      required: true,
      default: [],
      validate: [
        {
          validator: (installments) =>
            Array.isArray(installments) &&
            installments.every(
              (installment) =>
                installment.totalAmount + MONEY_EPSILON >=
                installment.principal + installment.interest
            ),
          message:
            'Installment totalAmount cannot be lower than principal plus interest.',
        },
        {
          validator: (installments) => {
            const numbers = installments.map(
              (installment) => installment.number
            );

            return new Set(numbers).size === numbers.length;
          },
          message: 'Installment numbers must be unique within the schedule.',
        },
      ],
    },

    // ------------------------------------------------------------------------
    // Contractual schedule totals
    // ------------------------------------------------------------------------

    totalPrincipal: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'totalPrincipal must be a finite non-negative amount.',
      },
    },

    totalInterest: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'totalInterest must be a finite non-negative amount.',
      },
    },

    /**
     * Contractual amount before penalties.
     */
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'totalAmount must be a finite non-negative amount.',
      },
    },

    // ------------------------------------------------------------------------
    // Repayment state
    // ------------------------------------------------------------------------

    totalPaid: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'totalPaid must be a finite non-negative amount.',
      },
    },

    totalPenalties: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'totalPenalties must be a finite non-negative amount.',
      },
    },

    /**
     * Derived amount:
     *
     *   contractual outstanding
     *   + penalties
     *   - paid amount
     *
     * It is never allowed to become negative.
     */
    outstandingAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isFiniteNonNegative,
        message: 'outstandingAmount must be a finite non-negative amount.',
      },
    },

    status: {
      type: String,
      required: true,
      enum: SCHEDULE_STATUSES,
      default: 'active',
      lowercase: true,
      trim: true,
      index: true,
    },

    completedAt: {
      type: Date,
    },

    defaultedAt: {
      type: Date,
    },

    suspendedAt: {
      type: Date,
    },

    suspensionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // ------------------------------------------------------------------------
    // Penalty policy snapshot
    // ------------------------------------------------------------------------

    penaltyConfig: {
      lateFeePercent: {
        type: Number,
        required: true,
        default: 2,
        min: 0,
        max: 100,
      },

      lateFeeFixed: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        validate: {
          validator: isFiniteNonNegative,
          message: 'lateFeeFixed must be a finite non-negative amount.',
        },
      },

      penaltyGraceDays: {
        type: Number,
        required: true,
        default: 5,
        min: 0,
        validate: {
          validator: Number.isInteger,
          message: 'penaltyGraceDays must be an integer.',
        },
      },

      /**
       * Maximum cumulative penalties as a percentage of schedule principal.
       */
      maxPenaltyPercent: {
        type: Number,
        required: true,
        default: 10,
        min: 0,
        max: 100,
      },
    },

    /**
     * Optional currency snapshot.
     * Useful to prevent accidentally applying a schedule calculation to a
     * different currency.
     */
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
      default: 'UGX',
    },
  },
  {
    timestamps: true,

    /**
     * Keep Mongoose's version key. It is useful for detecting concurrent
     * schedule modifications.
     */
    versionKey: '__v',
  }
);

// ============================================================================
// Indexes
// ============================================================================

loanRepaymentScheduleSchema.index(
  { tenantId: 1, loan: 1 },
  { unique: true, name: 'uniq_tenant_loan_repayment_schedule' }
);

loanRepaymentScheduleSchema.index(
  { tenantId: 1, status: 1 },
  { name: 'idx_tenant_schedule_status' }
);

loanRepaymentScheduleSchema.index(
  { tenantId: 1, 'installments.dueDate': 1, 'installments.status': 1 },
  { name: 'idx_tenant_installment_due_status' }
);

loanRepaymentScheduleSchema.index(
  { tenantId: 1, createdAt: -1 },
  { name: 'idx_tenant_schedule_created' }
);

// ============================================================================
// Internal calculation helpers
// ============================================================================

/**
 * Recalculate all schedule totals from the installment data.
 *
 * This is useful for controlled repair/reconciliation operations and for
 * service-layer consistency checks.
 */
loanRepaymentScheduleSchema.methods.recalculateTotals = function () {
  let principal = 0;
  let interest = 0;
  let contractualTotal = 0;
  let paid = 0;
  let penalties = 0;

  for (const installment of this.installments) {
    principal += normalizeMoney(installment.principal);
    interest += normalizeMoney(installment.interest);
    contractualTotal += normalizeMoney(installment.totalAmount);
    paid += normalizeMoney(installment.paidAmount);
    penalties += normalizeMoney(installment.penalties);
  }

  this.totalPrincipal = roundMoney(principal);
  this.totalInterest = roundMoney(interest);
  this.totalAmount = roundMoney(contractualTotal);
  this.totalPaid = roundMoney(paid);
  this.totalPenalties = roundMoney(penalties);

  this.outstandingAmount = Math.max(
    0,
    roundMoney(this.totalAmount + this.totalPenalties - this.totalPaid)
  );

  return {
    totalPrincipal: this.totalPrincipal,
    totalInterest: this.totalInterest,
    totalAmount: this.totalAmount,
    totalPaid: this.totalPaid,
    totalPenalties: this.totalPenalties,
    outstandingAmount: this.outstandingAmount,
  };
};

/**
 * Synchronize installment statuses with their current dates and balances.
 *
 * Paid and forgiven installments are never changed to overdue.
 */
loanRepaymentScheduleSchema.methods.refreshStatuses = function (
  referenceDate = new Date()
) {
  if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.valueOf())) {
    throw new TypeError('referenceDate must be a valid Date.');
  }

  const now = referenceDate;

  for (const installment of this.installments) {
    if (installment.status === 'forgiven') {
      continue;
    }

    if (installment.paidAmount >= installment.totalAmount - MONEY_EPSILON) {
      installment.paidAmount = roundMoney(
        Math.min(installment.paidAmount, installment.totalAmount)
      );
      installment.status = 'paid';

      if (!installment.paidAt) {
        installment.paidAt = now;
      }

      continue;
    }

    installment.paidAt = undefined;

    if (installment.paidAmount > MONEY_EPSILON) {
      installment.status =
        installment.dueDate < now ? 'overdue' : 'partially_paid';
    } else {
      installment.status =
        installment.dueDate < now ? 'overdue' : 'pending';
    }
  }

  if (areAllInstallmentsComplete(this.installments)) {
    this.status = 'completed';
    this.completedAt = this.completedAt || now;
  } else if (this.status === 'completed') {
    this.status = 'active';
    this.completedAt = undefined;
  }

  this.outstandingAmount = Math.max(
    0,
    roundMoney(this.totalAmount + this.totalPenalties - this.totalPaid)
  );

  return this;
};

// ============================================================================
// Penalty calculation
// ============================================================================

/**
 * Calculate and apply additional penalties to overdue installments.
 *
 * Important:
 *   - Penalties are NOT compounded against already-added penalties.
 *   - The schedule-level penalty cap is enforced.
 *   - Paid and forgiven installments are excluded.
 *   - This method only mutates the schedule document. The caller must save it
 *     inside the appropriate service-layer transaction/session.
 */
loanRepaymentScheduleSchema.methods.calculatePenalties = function (
  referenceDate = new Date()
) {
  if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.valueOf())) {
    throw new TypeError('referenceDate must be a valid Date.');
  }

  const now = referenceDate;

  const maximumSchedulePenalty = roundMoney(
    (this.totalPrincipal * this.penaltyConfig.maxPenaltyPercent) / 100
  );

  let currentTotalPenalty = roundMoney(
    Math.max(0, this.totalPenalties || 0)
  );

  let totalNewPenalties = 0;

  for (const installment of this.installments) {
    if (isTerminalInstallment(installment)) {
      continue;
    }

    const overdueDays = Math.floor(
      (now.getTime() - installment.dueDate.getTime()) / DAY_MS
    );

    if (overdueDays <= this.penaltyConfig.penaltyGraceDays) {
      continue;
    }

    const installmentOutstanding = Math.max(
      0,
      roundMoney(installment.totalAmount - installment.paidAmount)
    );

    if (installmentOutstanding <= MONEY_EPSILON) {
      continue;
    }

    let calculatedPenalty = 0;

    if (this.penaltyConfig.lateFeePercent > 0) {
      calculatedPenalty +=
        (installmentOutstanding * this.penaltyConfig.lateFeePercent) / 100;
    }

    if (this.penaltyConfig.lateFeeFixed > 0) {
      calculatedPenalty += this.penaltyConfig.lateFeeFixed;
    }

    calculatedPenalty = roundMoney(Math.max(0, calculatedPenalty));

    /**
     * Only the incremental amount is added. This prevents calling the method
     * repeatedly from inflating total penalties.
     */
    const incrementalPenalty = Math.max(
      0,
      roundMoney(calculatedPenalty - installment.penalties)
    );

    if (incrementalPenalty <= MONEY_EPSILON) {
      installment.status = 'overdue';
      continue;
    }

    const remainingSchedulePenaltyCapacity = Math.max(
      0,
      roundMoney(maximumSchedulePenalty - currentTotalPenalty)
    );

    const amountToAdd = roundMoney(
      Math.min(incrementalPenalty, remainingSchedulePenaltyCapacity)
    );

    if (amountToAdd > MONEY_EPSILON) {
      installment.penalties = roundMoney(
        installment.penalties + amountToAdd
      );

      currentTotalPenalty = roundMoney(
        currentTotalPenalty + amountToAdd
      );

      totalNewPenalties = roundMoney(
        totalNewPenalties + amountToAdd
      );
    }

    installment.status = 'overdue';
  }

  this.totalPenalties = currentTotalPenalty;

  this.outstandingAmount = Math.max(
    0,
    roundMoney(this.totalAmount + this.totalPenalties - this.totalPaid)
  );

  return totalNewPenalties;
};

// ============================================================================
// Payment allocation
// ============================================================================

/**
 * Record a settled payment against one installment.
 *
 * This method:
 *   - validates payment data;
 *   - rejects duplicate payment references;
 *   - prevents payments exceeding the contractual installment balance;
 *   - updates installment and schedule totals;
 *   - does NOT create or modify the canonical Transaction record.
 *
 * The caller should normally invoke this from a financial service inside a
 * MongoDB transaction using the same session as the canonical Transaction.
 */
loanRepaymentScheduleSchema.methods.recordPayment = function ({
  installmentNumber,
  amount,
  paymentMethod,
  reference,
  providerReference,
  transactionId,
  paidAt = new Date(),
}) {
  if (!Number.isInteger(installmentNumber) || installmentNumber < 1) {
    throw new TypeError('installmentNumber must be a positive integer.');
  }

  const paymentAmount = normalizeMoney(amount);

  if (!isPositiveFinite(paymentAmount)) {
    throw new RangeError('Payment amount must be greater than zero.');
  }

  if (!paymentMethod) {
    throw new TypeError('paymentMethod is required.');
  }

  if (!reference || typeof reference !== 'string') {
    throw new TypeError('A payment reference is required.');
  }

  if (!(paidAt instanceof Date) || Number.isNaN(paidAt.valueOf())) {
    throw new TypeError('paidAt must be a valid Date.');
  }

  const installment = this.installments.find(
    (item) => item.number === installmentNumber
  );

  if (!installment) {
    throw new Error(`Installment ${installmentNumber} not found.`);
  }

  if (['paid', 'forgiven'].includes(installment.status)) {
    throw new Error(
      `Installment ${installmentNumber} is already ${installment.status}.`
    );
  }

  /**
   * Idempotency guard:
   * the same financial transaction reference must never be applied twice to
   * this schedule.
   */
  const duplicateReference = this.installments.some((item) =>
    item.payments.some((payment) => payment.reference === reference)
  );

  if (duplicateReference) {
    return {
      duplicate: true,
      installment,
      schedule: this,
    };
  }

  /**
   * Payments apply to the contractual installment amount. Penalties are
   * tracked separately and are not silently converted into principal/interest.
   */
  const contractualOutstanding = Math.max(
    0,
    roundMoney(installment.totalAmount - installment.paidAmount)
  );

  if (paymentAmount > contractualOutstanding + MONEY_EPSILON) {
    throw new RangeError(
      `Payment of ${paymentAmount} exceeds installment ${installmentNumber} ` +
        `contractual outstanding amount of ${contractualOutstanding}.`
    );
  }

  installment.paidAmount = roundMoney(
    installment.paidAmount + paymentAmount
  );

  installment.payments.push({
    amount: paymentAmount,
    paidAt,
    method: paymentMethod,
    reference: reference.trim(),
    providerReference: providerReference?.trim(),
    transactionId,
  });

  this.totalPaid = roundMoney(this.totalPaid + paymentAmount);

  if (
    installment.paidAmount >=
    installment.totalAmount - MONEY_EPSILON
  ) {
    installment.paidAmount = roundMoney(
      Math.min(installment.paidAmount, installment.totalAmount)
    );

    installment.status = 'paid';
    installment.paidAt = paidAt;
  } else {
    installment.status =
      installment.dueDate < paidAt ? 'overdue' : 'partially_paid';
  }

  this.outstandingAmount = Math.max(
    0,
    roundMoney(this.totalAmount + this.totalPenalties - this.totalPaid)
  );

  if (areAllInstallmentsComplete(this.installments)) {
    this.status = 'completed';
    this.completedAt = this.completedAt || paidAt;
  } else if (this.status === 'completed') {
    this.status = 'active';
    this.completedAt = undefined;
  }

  return {
    duplicate: false,
    installment,
    schedule: this,
  };
};

// ============================================================================
// Forgiveness
// ============================================================================

/**
 * Forgive the remaining contractual balance of one installment.
 *
 * This is deliberately separate from payment recording. A forgiven amount is
 * not represented as cash received.
 */
loanRepaymentScheduleSchema.methods.forgiveInstallment = function (
  installmentNumber,
  reason,
  forgivenAt = new Date()
) {
  const installment = this.installments.find(
    (item) => item.number === installmentNumber
  );

  if (!installment) {
    throw new Error(`Installment ${installmentNumber} not found.`);
  }

  if (installment.status === 'paid') {
    throw new Error(`Installment ${installmentNumber} is already paid.`);
  }

  if (!(forgivenAt instanceof Date) || Number.isNaN(forgivenAt.valueOf())) {
    throw new TypeError('forgivenAt must be a valid Date.');
  }

  installment.status = 'forgiven';
  installment.forgivenAt = forgivenAt;
  installment.forgivenessReason =
    typeof reason === 'string' ? reason.trim() : undefined;

  if (areAllInstallmentsComplete(this.installments)) {
    this.status = 'completed';
    this.completedAt = this.completedAt || forgivenAt;
  }

  return installment;
};

// ============================================================================
// Query/read helpers
// ============================================================================

/**
 * Get the next unpaid installment that is already due or is upcoming,
 * depending on the optional reference date.
 */
loanRepaymentScheduleSchema.methods.getNextDueInstallment = function (
  referenceDate = new Date()
) {
  const now = referenceDate;

  return [...this.installments]
    .filter((installment) => !isTerminalInstallment(installment))
    .sort((a, b) => {
      const dueDateDifference = a.dueDate - b.dueDate;

      return dueDateDifference !== 0
        ? dueDateDifference
        : a.number - b.number;
    })
    .find((installment) => installment.dueDate <= now);
};

/**
 * Get installments due within the specified future period.
 */
loanRepaymentScheduleSchema.methods.getUpcomingInstallments = function (
  days = 30,
  referenceDate = new Date()
) {
  if (!Number.isFinite(days) || days < 0) {
    throw new RangeError('days must be a finite non-negative number.');
  }

  const now = referenceDate;
  const endDate = new Date(now.getTime() + days * DAY_MS);

  return [...this.installments]
    .filter(
      (installment) =>
        !isTerminalInstallment(installment) &&
        installment.dueDate > now &&
        installment.dueDate <= endDate
    )
    .sort((a, b) => {
      const dueDateDifference = a.dueDate - b.dueDate;

      return dueDateDifference !== 0
        ? dueDateDifference
        : a.number - b.number;
    });
};

/**
 * Get all currently overdue installments.
 */
loanRepaymentScheduleSchema.methods.getOverdueInstallments = function (
  referenceDate = new Date()
) {
  const now = referenceDate;

  return [...this.installments]
    .filter(
      (installment) =>
        !isTerminalInstallment(installment) &&
        installment.dueDate < now
    )
    .sort((a, b) => {
      const dueDateDifference = a.dueDate - b.dueDate;

      return dueDateDifference !== 0
        ? dueDateDifference
        : a.number - b.number;
    });
};

/**
 * Get payment summary.
 */
loanRepaymentScheduleSchema.methods.getPaymentSummary = function () {
  const totalAmount = normalizeMoney(this.totalAmount);
  const totalPaid = normalizeMoney(this.totalPaid);
  const totalPenalties = normalizeMoney(this.totalPenalties);

  const outstandingAmount = Math.max(
    0,
    roundMoney(totalAmount + totalPenalties - totalPaid)
  );

  const paymentPercentage =
    totalAmount > 0
      ? Math.min(100, Math.round((totalPaid / totalAmount) * 100))
      : 0;

  const nextDueInstallment = [...this.installments]
    .filter((installment) => !isTerminalInstallment(installment))
    .sort((a, b) => {
      const dueDateDifference = a.dueDate - b.dueDate;

      return dueDateDifference !== 0
        ? dueDateDifference
        : a.number - b.number;
    })[0];

  return {
    currency: this.currency,
    totalPrincipal: this.totalPrincipal,
    totalInterest: this.totalInterest,
    totalAmount,
    totalPaid,
    totalPenalties,
    outstandingAmount,
    paymentPercentage,
    completedInstallments: this.installments.filter(
      (installment) =>
        ['paid', 'forgiven'].includes(installment.status)
    ).length,
    installmentCount: this.installments.length,
    overdueInstallments: this.getOverdueInstallments().length,
    status: this.status,
    nextDueDate: nextDueInstallment?.dueDate,
    nextDueInstallmentNumber: nextDueInstallment?.number,
  };
};

// ============================================================================
// Static helpers
// ============================================================================

/**
 * Find the schedule for a loan within a tenant.
 *
 * Tenant ID is always part of the lookup to prevent cross-tenant access.
 */
loanRepaymentScheduleSchema.statics.findByLoan = function (
  tenantId,
  loanId
) {
  return this.findOne({
    tenantId,
    loan: loanId,
  });
};

/**
 * Validate that a schedule's contractual totals agree with its installments.
 */
loanRepaymentScheduleSchema.statics.validateFinancialConsistency = function (
  schedule
) {
  if (!schedule) {
    return {
      valid: false,
      errors: ['Schedule is required.'],
    };
  }

  const errors = [];

  let principal = 0;
  let interest = 0;
  let total = 0;
  let paid = 0;
  let penalties = 0;

  for (const installment of schedule.installments) {
    principal += normalizeMoney(installment.principal);
    interest += normalizeMoney(installment.interest);
    total += normalizeMoney(installment.totalAmount);
    paid += normalizeMoney(installment.paidAmount);
    penalties += normalizeMoney(installment.penalties);

    if (
      installment.totalAmount + MONEY_EPSILON <
      installment.principal + installment.interest
    ) {
      errors.push(
        `Installment ${installment.number}: totalAmount is below ` +
          `principal + interest.`
      );
    }

    if (
      installment.paidAmount >
      installment.totalAmount + MONEY_EPSILON
    ) {
      errors.push(
        `Installment ${installment.number}: paidAmount exceeds totalAmount.`
      );
    }
  }

  const calculatedOutstanding = Math.max(
    0,
    roundMoney(total + penalties - paid)
  );

  if (
    Math.abs(roundMoney(principal) - roundMoney(schedule.totalPrincipal)) >
    MONEY_EPSILON
  ) {
    errors.push('totalPrincipal does not match installment totals.');
  }

  if (
    Math.abs(roundMoney(interest) - roundMoney(schedule.totalInterest)) >
    MONEY_EPSILON
  ) {
    errors.push('totalInterest does not match installment totals.');
  }

  if (
    Math.abs(roundMoney(total) - roundMoney(schedule.totalAmount)) >
    MONEY_EPSILON
  ) {
    errors.push('totalAmount does not match installment totals.');
  }

  if (
    Math.abs(roundMoney(paid) - roundMoney(schedule.totalPaid)) >
    MONEY_EPSILON
  ) {
    errors.push('totalPaid does not match installment totals.');
  }

  if (
    Math.abs(roundMoney(penalties) - roundMoney(schedule.totalPenalties)) >
    MONEY_EPSILON
  ) {
    errors.push('totalPenalties does not match installment totals.');
  }

  if (
    Math.abs(
      calculatedOutstanding - roundMoney(schedule.outstandingAmount)
    ) > MONEY_EPSILON
  ) {
    errors.push('outstandingAmount is inconsistent with schedule totals.');
  }

  return {
    valid: errors.length === 0,
    errors,
    calculated: {
      totalPrincipal: roundMoney(principal),
      totalInterest: roundMoney(interest),
      totalAmount: roundMoney(total),
      totalPaid: roundMoney(paid),
      totalPenalties: roundMoney(penalties),
      outstandingAmount: calculatedOutstanding,
    },
  };
};

// ============================================================================
// Document validation
// ============================================================================

loanRepaymentScheduleSchema.pre('validate', function () {
  const schedule = this;

  if (!schedule.installments.length) {
    throw new Error('A repayment schedule must contain at least one installment.');
  }

  if (
    schedule.totalAmount + MONEY_EPSILON <
    schedule.totalPrincipal + schedule.totalInterest
  ) {
    throw new Error(
      'Schedule totalAmount cannot be lower than totalPrincipal + totalInterest.'
    );
  }

  if (
    schedule.totalPaid >
    schedule.totalAmount + MONEY_EPSILON
  ) {
    throw new Error(
      'Schedule totalPaid cannot exceed the contractual totalAmount.'
    );
  }

  const maximumPenalty = roundMoney(
    (schedule.totalPrincipal * schedule.penaltyConfig.maxPenaltyPercent) /
      100
  );

  if (
    schedule.totalPenalties >
    maximumPenalty + MONEY_EPSILON
  ) {
    throw new Error(
      'totalPenalties exceeds the configured schedule penalty cap.'
    );
  }

  const consistency =
    schedule.constructor.validateFinancialConsistency(schedule);

  if (!consistency.valid) {
    throw new Error(
      `Financial consistency validation failed: ${consistency.errors.join(
        ' | '
      )}`
    );
  }
});

// ============================================================================
// Model export
// ============================================================================

const LoanRepaymentSchedule =
  mongoose.models.LoanRepaymentSchedule ||
  mongoose.model(
    'LoanRepaymentSchedule',
    loanRepaymentScheduleSchema
  );

export default LoanRepaymentSchedule;

export {
  INSTALLMENT_STATUSES,
  SCHEDULE_STATUSES,
  PAYMENT_METHODS,
};