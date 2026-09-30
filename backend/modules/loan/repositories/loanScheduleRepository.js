/**
 * ============================================================================
 * TITech Community Capital LTD
 * Canonical Loan Schedule Repository
 * ============================================================================
 *
 * File:
 *   backend/modules/loan/repositories/loanScheduleRepository.js
 *
 * Purpose:
 *   Provide the single persistence boundary for contractual loan repayment
 *   schedules used by LoanWorkflowService.
 *
 * Architectural boundaries:
 *   - Always tenant-scoped.
 *   - No controller logic.
 *   - No ledger mutation.
 *   - No payment-provider settlement.
 *   - Repayment allocation is limited to the schedule's persisted contractual
 *     installments and must be invoked from the financial service transaction
 *     when a canonical Transaction record exists.
 *
 * ESM is intentional. The repository was previously referenced by the loan
 * workflow but did not exist in the canonical module tree.
 * ============================================================================
 */

import crypto from 'node:crypto';

import Loan from '../../../models/Loan.js';
import LoanRepaymentSchedule, {
  PAYMENT_METHODS,
} from '../../../models/LoanRepaymentSchedule.js';

const EPSILON = 1e-9;
const MAX_TERM_MONTHS = 120;
const DEFAULT_CURRENCY = 'UGX';

function assertTenantId(tenantId) {
  if (tenantId === undefined || tenantId === null || String(tenantId).trim() === '') {
    throw new Error('tenantId is required');
  }
}

function assertLoanId(loanId) {
  if (loanId === undefined || loanId === null || String(loanId).trim() === '') {
    throw new Error('loanId is required');
  }
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeTerm(value, fallback = 1) {
  const term = Math.floor(Number(value));
  return Number.isInteger(term) && term >= 1
    ? Math.min(term, MAX_TERM_MONTHS)
    : fallback;
}

function normalizeInterestRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : 0;
}

function normalizeCurrency(value) {
  const currency = String(value || DEFAULT_CURRENCY).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_CURRENCY;
}

function toDate(value, fallback = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || fallback);
  return Number.isNaN(date.valueOf()) ? new Date(fallback) : date;
}

function addMonths(date, months) {
  const result = new Date(date.getTime());
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);

  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();

  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

/**
 * Calculate a deterministic amortization schedule.
 *
 * The returned array uses the canonical LoanRepaymentSchedule installment
 * field names. The last installment absorbs rounding residue so that the
 * schedule principal/interest totals equal the contractual totals.
 */
export function calculateAmortizationSchedule({
  principal,
  annualInterestRate = 0,
  termMonths = 1,
  firstDueDate = new Date(),
}) {
  const amount = roundMoney(positiveNumber(principal));
  const term = normalizeTerm(termMonths);
  const annualRate = normalizeInterestRate(annualInterestRate);

  if (amount <= EPSILON) {
    throw new RangeError('Loan principal must be greater than zero');
  }

  const monthlyRate = annualRate / 100 / 12;
  const rawPayment = monthlyRate > EPSILON
    ? amount * (monthlyRate * ((1 + monthlyRate) ** term)) /
      (((1 + monthlyRate) ** term) - 1)
    : amount / term;

  const installments = [];
  let remainingPrincipal = amount;
  let totalInterest = 0;

  for (let number = 1; number <= term; number += 1) {
    const interest = monthlyRate > EPSILON
      ? roundMoney(remainingPrincipal * monthlyRate)
      : 0;

    const principalPayment = number === term
      ? roundMoney(remainingPrincipal)
      : roundMoney(Math.max(0, rawPayment - interest));

    const totalAmount = roundMoney(principalPayment + interest);

    installments.push({
      number,
      dueDate: addMonths(toDate(firstDueDate), number - 1),
      principal: principalPayment,
      interest,
      totalAmount,
      paidAmount: 0,
      penalties: 0,
      status: 'pending',
      payments: [],
    });

    remainingPrincipal = roundMoney(Math.max(0, remainingPrincipal - principalPayment));
    totalInterest = roundMoney(totalInterest + interest);
  }

  return {
    installments,
    totalPrincipal: amount,
    totalInterest,
    totalAmount: roundMoney(amount + totalInterest),
  };
}

function scheduleFieldsForLoan(loan, overrides = {}) {
  const principal = positiveNumber(
    overrides.principal ?? loan?.amount ?? loan?.principal,
  );

  const term = normalizeTerm(
    overrides.term ??
      overrides.repaymentPeriodMonths ??
      loan?.repaymentPeriodMonths ??
      loan?.term ??
      loan?.duration,
    6,
  );

  const interestRate = normalizeInterestRate(
    overrides.interestRate ?? loan?.interestRate,
  );

  const moratoriumMonths = Math.max(
    0,
    Math.min(
      term,
      Math.floor(Number(overrides.moratoriumMonths ?? 0)),
    ),
  );

  const disbursementDate = toDate(
    overrides.disbursedAt ?? loan?.disbursedAt ?? loan?.disburseDate ?? new Date(),
  );

  const firstDueDate = addMonths(disbursementDate, moratoriumMonths + 1);
  const calculated = calculateAmortizationSchedule({
    principal,
    annualInterestRate: interestRate,
    termMonths: term,
    firstDueDate,
  });

  return {
    ...calculated,
    currency: normalizeCurrency(overrides.currency ?? loan?.currency),
    penaltyConfig: overrides.penaltyConfig,
  };
}

function applySession(query, session) {
  return session && typeof query?.session === 'function'
    ? query.session(session)
    : query;
}

function normalizePaymentMethod(value) {
  const candidate = String(value || '').trim().toLowerCase();
  const aliases = {
    mobile_money: 'mtn_momo',
    momo: 'mtn_momo',
    airtel: 'airtel_money',
    mpesa: 'other',
    card: 'other',
    cash: 'cash',
    bank: 'bank',
    internal: 'internal',
  };

  const normalized = aliases[candidate] || candidate;
  return PAYMENT_METHODS.includes(normalized) ? normalized : 'internal';
}

async function loadLoan(loanId, tenantId, session) {
  assertTenantId(tenantId);
  assertLoanId(loanId);

  let query = Loan.findOne({
    _id: loanId,
    tenantId,
  });
  query = applySession(query, session);
  const loan = await query;

  if (!loan) {
    throw new Error(`Loan ${loanId} was not found for tenant ${tenantId}`);
  }

  return loan;
}

const LoanScheduleRepository = {
  calculateAmortizationSchedule,
  async findByLoan(loanId, tenantId, options = {}) {
    assertTenantId(tenantId);
    assertLoanId(loanId);

    let query = LoanRepaymentSchedule.findOne({
      tenantId,
      loan: loanId,
    });
    query = applySession(query, options.session);

    return query;
  },

  async generateSchedule(loanId, tenantId, options = {}) {
    const loan = await loadLoan(loanId, tenantId, options.session);

    let existingQuery = LoanRepaymentSchedule.findOne({
      tenantId,
      loan: loanId,
    });
    existingQuery = applySession(existingQuery, options.session);
    const existing = await existingQuery;

    if (existing && options.force !== true) {
      return existing;
    }

    const calculated = scheduleFieldsForLoan(loan, options);
    const payload = {
      tenantId,
      loan: loanId,
      installments: calculated.installments,
      totalPrincipal: calculated.totalPrincipal,
      totalInterest: calculated.totalInterest,
      totalAmount: calculated.totalAmount,
      totalPaid: 0,
      totalPenalties: 0,
      outstandingAmount: calculated.totalAmount,
      status: 'active',
      currency: calculated.currency,
    };

    if (calculated.penaltyConfig) payload.penaltyConfig = calculated.penaltyConfig;

    if (existing && options.force === true) {
      existing.set(payload);
      await existing.save(options.session ? { session: options.session } : undefined);
      return existing;
    }

    try {
      const [created] = await LoanRepaymentSchedule.create(
        [payload],
        options.session ? { session: options.session } : undefined,
      );
      return created;
    } catch (error) {
      // A concurrent worker may have won the unique tenant+loan race. Re-read
      // rather than generating a second contractual schedule.
      if (error?.code === 11000) {
        let retry = LoanRepaymentSchedule.findOne({ tenantId, loan: loanId });
        retry = applySession(retry, options.session);
        const concurrent = await retry;
        if (concurrent) return concurrent;
      }
      throw error;
    }
  },

  async applyRepayment(loanId, amount, tenantId, options = {}) {
    assertTenantId(tenantId);
    assertLoanId(loanId);

    const paymentAmount = roundMoney(Number(amount));
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw new RangeError('Repayment amount must be greater than zero');
    }

    const reference = String(
      options.reference || options.transactionReference || '',
    ).trim();

    if (!reference) {
      throw new Error(
        'A stable repayment reference is required for schedule idempotency',
      );
    }

    let query = LoanRepaymentSchedule.findOne({
      tenantId,
      loan: loanId,
    });
    query = applySession(query, options.session);
    const schedule = await query;

    if (!schedule) {
      throw new Error(`Repayment schedule for loan ${loanId} was not found`);
    }

    const alreadyApplied = schedule.installments.some((installment) =>
      installment.payments.some((payment) => payment.reference === reference),
    );

    if (alreadyApplied) {
      return {
        duplicate: true,
        schedule,
      };
    }

    const contractualOutstanding = roundMoney(
      Math.max(0, schedule.totalAmount - schedule.totalPaid),
    );

    if (paymentAmount > contractualOutstanding + EPSILON) {
      throw new RangeError(
        `Repayment amount exceeds schedule contractual outstanding amount of ${contractualOutstanding}`,
      );
    }

    let remaining = paymentAmount;
    const paymentMethod = normalizePaymentMethod(
      options.paymentMethod || options.channel,
    );

    const candidates = [...schedule.installments]
      .filter((installment) => !['paid', 'forgiven'].includes(installment.status))
      .sort((a, b) => {
        const dateDelta = new Date(a.dueDate).valueOf() - new Date(b.dueDate).valueOf();
        return dateDelta !== 0 ? dateDelta : a.number - b.number;
      });

    for (const installment of candidates) {
      if (remaining <= EPSILON) break;
      const outstanding = roundMoney(
        Math.max(0, installment.totalAmount - installment.paidAmount),
      );
      if (outstanding <= EPSILON) continue;

      const allocated = roundMoney(Math.min(outstanding, remaining));
      schedule.recordPayment({
        installmentNumber: installment.number,
        amount: allocated,
        paymentMethod,
        reference,
        providerReference: options.providerReference,
        transactionId: options.transactionId,
        paidAt: toDate(options.paidAt, new Date()),
      });
      remaining = roundMoney(remaining - allocated);
    }

    schedule.outstandingAmount = roundMoney(
      Math.max(0, schedule.totalAmount + schedule.totalPenalties - schedule.totalPaid),
    );

    if (schedule.outstandingAmount <= EPSILON) {
      schedule.status = 'completed';
      schedule.completedAt = schedule.completedAt || toDate(options.paidAt, new Date());
    }

    await schedule.save(options.session ? { session: options.session } : undefined);

    return {
      duplicate: false,
      schedule,
      amountApplied: paymentAmount,
    };
  },

  async regenerateSchedule(loanId, changes = {}, tenantId, options = {}) {
    const loan = await loadLoan(loanId, tenantId, options.session);

    let query = LoanRepaymentSchedule.findOne({
      tenantId,
      loan: loanId,
    });
    query = applySession(query, options.session);
    const schedule = await query;

    if (!schedule) {
      return this.generateSchedule(loanId, tenantId, {
        ...options,
        ...changes,
      });
    }

    const hasFinancialActivity = schedule.installments.some(
      (installment) =>
        Number(installment.paidAmount || 0) > EPSILON ||
        installment.payments.length > 0,
    );

    if (hasFinancialActivity) {
      throw new Error(
        'Cannot regenerate a repayment schedule after financial repayments have been applied',
      );
    }

    const calculated = scheduleFieldsForLoan(loan, changes);

    schedule.set({
      installments: calculated.installments,
      totalPrincipal: calculated.totalPrincipal,
      totalInterest: calculated.totalInterest,
      totalAmount: calculated.totalAmount,
      totalPaid: 0,
      totalPenalties: 0,
      outstandingAmount: calculated.totalAmount,
      status: 'active',
      completedAt: undefined,
      defaultedAt: undefined,
      suspendedAt: undefined,
      currency: calculated.currency,
      penaltyConfig: calculated.penaltyConfig || schedule.penaltyConfig,
    });

    await schedule.save(options.session ? { session: options.session } : undefined);
    return schedule;
  },
};

// Preserve a stable named export for future dependency injection while the
// default export remains the contract consumed by LoanWorkflowService.
export { LoanScheduleRepository };
export default LoanScheduleRepository;
