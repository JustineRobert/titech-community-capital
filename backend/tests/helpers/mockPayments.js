'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Payment Testing Helpers
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Loan Repayment Fixtures
 * ✅ Mobile Money Fixtures
 * ✅ Bank Transfer Fixtures
 * ✅ Savings Transactions
 * ✅ Share Purchases
 * ✅ Payment Factories
 * ✅ Payment Builders
 * ✅ Mock Webhooks
 * ✅ Settlement Testing
 * ✅ Reconciliation Testing
 * ✅ Jest Compatible
 * ✅ Vitest Compatible
 * ============================================================================
 */

const { v4: uuidv4 } = require('uuid');

/* ============================================================================
   BASE MOCK PAYMENT BUILDER
============================================================================ */

class BasePaymentBuilder {
  constructor(defaults = {}) {
    this._data = Object.freeze({ ...defaults });
  }

  with(key, value) {
    return new this.constructor({ ...this._data, [key]: value });
  }

  merge(values = {}) {
    return new this.constructor({ ...this._data, ...values });
  }

  build() {
    return { ...this._data };
  }
}

/* ============================================================================
   PAYMENT FIXTURES
============================================================================ */

const mockLoanRepayment = {
  id: uuidv4(),
  type: 'loan_repayment',
  loanId: uuidv4(),
  amount: 50000,
  currency: 'UGX',
  method: 'mobile_money',
  timestamp: new Date().toISOString(),
};

const mockMobileMoneyPayment = {
  id: uuidv4(),
  type: 'mobile_money',
  provider: 'MTN MoMo',
  msisdn: '+256782397907',
  amount: 20000,
  currency: 'UGX',
  reference: 'MM-' + Date.now(),
  timestamp: new Date().toISOString(),
};

const mockBankTransfer = {
  id: uuidv4(),
  type: 'bank_transfer',
  bank: 'Centenary Bank',
  accountNumber: '1234567890',
  amount: 100000,
  currency: 'UGX',
  reference: 'BT-' + Date.now(),
  timestamp: new Date().toISOString(),
};

const mockSavingsTransaction = {
  id: uuidv4(),
  type: 'savings_deposit',
  memberId: uuidv4(),
  amount: 30000,
  currency: 'UGX',
  timestamp: new Date().toISOString(),
};

const mockSharePurchase = {
  id: uuidv4(),
  type: 'share_purchase',
  memberId: uuidv4(),
  shares: 10,
  pricePerShare: 5000,
  currency: 'UGX',
  totalAmount: 50000,
  timestamp: new Date().toISOString(),
};

/* ============================================================================
   SPECIALIZED PAYMENT BUILDERS
============================================================================ */

class LoanRepaymentBuilder extends BasePaymentBuilder {
  constructor(defaults = mockLoanRepayment) {
    super(defaults);
  }
}

class MobileMoneyBuilder extends BasePaymentBuilder {
  constructor(defaults = mockMobileMoneyPayment) {
    super(defaults);
  }
}

class BankTransferBuilder extends BasePaymentBuilder {
  constructor(defaults = mockBankTransfer) {
    super(defaults);
  }
}

class SavingsBuilder extends BasePaymentBuilder {
  constructor(defaults = mockSavingsTransaction) {
    super(defaults);
  }
}

class SharePurchaseBuilder extends BasePaymentBuilder {
  constructor(defaults = mockSharePurchase) {
    super(defaults);
  }
}

/* ============================================================================
   MOCK WEBHOOKS & SETTLEMENT HELPERS
============================================================================ */

function mockWebhookEvent(payment) {
  return {
    eventId: uuidv4(),
    eventType: 'PAYMENT_RECEIVED',
    payload: payment,
    receivedAt: new Date().toISOString(),
  };
}

function mockSettlement(payment) {
  return {
    settlementId: uuidv4(),
    paymentId: payment.id,
    status: 'SETTLED',
    settledAt: new Date().toISOString(),
  };
}

function mockReconciliation(payments) {
  return {
    reconciliationId: uuidv4(),
    totalPayments: payments.length,
    totalAmount: payments.reduce((sum, p) => sum + (p.amount || 0), 0),
    currency: 'UGX',
    reconciledAt: new Date().toISOString(),
  };
}

/* ============================================================================
   EXPORTS
============================================================================ */

module.exports = {
  LoanRepaymentBuilder,
  MobileMoneyBuilder,
  BankTransferBuilder,
  SavingsBuilder,
  SharePurchaseBuilder,
  mockWebhookEvent,
  mockSettlement,
  mockReconciliation,
};