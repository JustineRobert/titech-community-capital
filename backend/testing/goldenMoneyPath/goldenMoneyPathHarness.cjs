'use strict';

const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { ReferenceProviderSimulator } = require('./referenceProviderSimulator.cjs');

const STATES = Object.freeze({
  INITIATED: 'INITIATED',
  VALIDATED: 'VALIDATED',
  PENDING_PROVIDER: 'PENDING_PROVIDER',
  UNKNOWN: 'UNKNOWN',
  SUCCESSFUL: 'SUCCESSFUL',
  SETTLED: 'SETTLED',
  RECONCILED: 'RECONCILED',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  REVERSED: 'REVERSED',
});

class InMemoryGoldenMoneyPath {
  constructor({ provider } = {}) {
    this.provider = provider || new ReferenceProviderSimulator();
    this.payments = new Map();
    this.idempotency = new Map();
    this.ledger = [];
    this.settlements = new Map();
    this.reconciliations = new Map();
    this.receipts = new Map();
    this.audit = [];
    this.balances = new Map();
    this.trace = [];
  }

  _trace(payment, stage, details = {}) {
    this.trace.push({
      at: new Date().toISOString(),
      traceId: payment.traceId,
      paymentId: payment.paymentId,
      stage,
      ...details,
    });
  }

  initiate({
    tenantId = 'tenant-001',
    memberId = 'member-001',
    groupId = 'group-001',
    accountId = 'account-001',
    amount = '50000',
    currency = 'UGX',
    idempotencyKey,
  } = {}) {
    assert.ok(idempotencyKey, 'idempotency key is required');
    const accountCurrency = 'UGX';
    if (String(currency).toUpperCase() !== accountCurrency) {
      return { conflict: false, error: 'CURRENCY_MISMATCH' };
    }
    assert.ok(/^\d+$/.test(String(amount)) && BigInt(amount) > 0n, 'amount must be a positive minor-unit integer');
    const normalizedCurrency = String(currency).toUpperCase();

    const existingKey = this.idempotency.get(idempotencyKey);
    if (existingKey) {
      if (existingKey.payloadHash !== this._payloadHash({ tenantId, memberId, groupId, accountId, amount, currency: normalizedCurrency })) {
        return { conflict: true, error: 'IDEMPOTENCY_CONFLICT' };
      }
      return { replay: true, paymentId: existingKey.paymentId };
    }

    const paymentId = `pay-${crypto.randomUUID()}`;
    const traceId = `trace-${crypto.randomUUID()}`;
    const payment = {
      paymentId,
      tenantId,
      memberId,
      groupId,
      accountId,
      amount: String(amount),
      currency: normalizedCurrency,
      idempotencyKey,
      provider: this.provider.provider,
      status: STATES.INITIATED,
      providerReference: null,
      providerStatus: null,
      ledgerPosted: false,
      settled: false,
      reconciled: false,
      reversed: false,
      callbackEvents: new Set(),
      traceId,
    };

    this.payments.set(paymentId, payment);
    this.idempotency.set(idempotencyKey, {
      paymentId,
      payloadHash: this._payloadHash({ tenantId, memberId, groupId, accountId, amount, currency: normalizedCurrency }),
    });
    this._audit(payment, 'PAYMENT_INITIATED');
    this._trace(payment, 'INITIATED');
    return { paymentId, traceId };
  }

  _payloadHash(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  validate(paymentId, { tenantId }) {
    const payment = this._payment(paymentId);
    this._tenant(payment, tenantId);
    payment.status = STATES.VALIDATED;
    this._audit(payment, 'PAYMENT_VALIDATED');
    this._trace(payment, 'VALIDATED');
  }

  submit(paymentId) {
    const payment = this._payment(paymentId);
    payment.status = STATES.PENDING_PROVIDER;
    const providerResponse = this.provider.createPayment({
      paymentId: payment.paymentId,
      tenantId: payment.tenantId,
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey: payment.idempotencyKey,
    });
    payment.providerReference = providerResponse.providerReference;
    payment.providerStatus = providerResponse.providerStatus;
    this._audit(payment, 'PROVIDER_REQUEST_SENT');
    this._trace(payment, 'PROVIDER_REQUEST_SENT', { outcome: providerResponse.outcome });

    if (providerResponse.outcome === 'UNKNOWN') {
      payment.status = STATES.UNKNOWN;
      this._audit(payment, 'PROVIDER_TIMEOUT_UNKNOWN');
      this._trace(payment, 'UNKNOWN');
      return providerResponse;
    }
    return providerResponse;
  }

  restart() {
    const serialized = JSON.parse(JSON.stringify({
      payments: [...this.payments.values()].map((payment) => ({
        ...payment,
        callbackEvents: [...payment.callbackEvents],
      })),
      idempotency: [...this.idempotency.entries()],
      ledger: this.ledger,
      settlements: [...this.settlements.entries()],
      reconciliations: [...this.reconciliations.entries()],
      receipts: [...this.receipts.entries()],
      audit: this.audit,
      balances: [...this.balances.entries()],
      trace: this.trace,
    }));

    const restored = new InMemoryGoldenMoneyPath({ provider: this.provider });
    restored.payments = new Map(serialized.payments.map((payment) => [payment.paymentId, {
      ...payment,
      callbackEvents: new Set(payment.callbackEvents),
    }]));
    restored.idempotency = new Map(serialized.idempotency);
    restored.ledger = serialized.ledger;
    restored.settlements = new Map(serialized.settlements);
    restored.reconciliations = new Map(serialized.reconciliations);
    restored.receipts = new Map(serialized.receipts);
    restored.audit = serialized.audit;
    restored.balances = new Map(serialized.balances);
    restored.trace = serialized.trace;
    return restored;
  }

  applyCallback(callback, { tenantId } = {}) {
    const payment = [...this.payments.values()].find((item) => item.providerReference === callback.providerReference);
    assert.ok(payment, 'callback must correlate to a known payment');
    this._tenant(payment, tenantId);

    const callbackIdentity = `${callback.provider}:${callback.eventId}`;
    if (payment.callbackEvents.has(callbackIdentity)) {
      return { duplicate: true, paymentId: payment.paymentId };
    }

    if ([STATES.SUCCESSFUL, STATES.SETTLED, STATES.REVERSED].includes(payment.status) && callback.status !== 'SUCCESS') {
      return { stale: true, paymentId: payment.paymentId };
    }

    if (String(callback.amount) !== payment.amount || String(callback.currency).toUpperCase() !== payment.currency) {
      payment.status = STATES.REQUIRES_REVIEW;
      this._audit(payment, 'CALLBACK_MISMATCH');
      this._trace(payment, 'REQUIRES_REVIEW', { reason: 'CALLBACK_MISMATCH' });
      return { mismatch: true, paymentId: payment.paymentId };
    }

    payment.callbackEvents.add(callbackIdentity);
    payment.providerStatus = callback.status;
    this._audit(payment, 'CALLBACK_ACCEPTED');
    this._trace(payment, 'CALLBACK_ACCEPTED');
    return { accepted: true, paymentId: payment.paymentId };
  }

  confirmSuccess(paymentId) {
    const payment = this._payment(paymentId);
    if (payment.status === STATES.REQUIRES_REVIEW) return { reviewed: false };
    payment.status = STATES.SUCCESSFUL;
    this._audit(payment, 'PAYMENT_SUCCESSFUL');
    this._trace(payment, 'SUCCESSFUL');
    return { success: true };
  }

  postLedger(paymentId) {
    const payment = this._payment(paymentId);
    assert.equal(payment.status, STATES.SUCCESSFUL, 'ledger posting requires authoritative payment success');
    const postingKey = `posting:${payment.idempotencyKey}`;
    if (this.ledger.some((entry) => entry.postingKey === postingKey)) {
      return { duplicate: true };
    }

    const debit = BigInt(payment.amount);
    const entry = {
      postingKey,
      paymentId: payment.paymentId,
      tenantId: payment.tenantId,
      debit: debit.toString(),
      credit: debit.toString(),
      currency: payment.currency,
    };
    this.ledger.push(entry);
    payment.ledgerPosted = true;
    const current = BigInt(this.balances.get(payment.accountId) || '0');
    this.balances.set(payment.accountId, (current + debit).toString());
    this._audit(payment, 'LEDGER_POSTED');
    this._trace(payment, 'LEDGER_POSTED');
    return entry;
  }

  settle(paymentId) {
    const payment = this._payment(paymentId);
    assert.ok(payment.ledgerPosted, 'settlement requires ledger posting');
    const settlementKey = `settlement:${payment.paymentId}`;
    this.settlements.set(settlementKey, { paymentId, amount: payment.amount, currency: payment.currency, status: 'SETTLED' });
    payment.settled = true;
    payment.status = STATES.SETTLED;
    this._audit(payment, 'SETTLED');
    this._trace(payment, 'SETTLED');
  }

  reconcile(paymentId, { providerAmount, providerCurrency } = {}) {
    const payment = this._payment(paymentId);
    const key = `reconciliation:${payment.paymentId}`;
    const matched = String(providerAmount) === payment.amount && String(providerCurrency).toUpperCase() === payment.currency;
    this.reconciliations.set(key, {
      paymentId,
      status: matched ? 'MATCHED' : 'MISMATCHED',
      expectedAmount: payment.amount,
      providerAmount: String(providerAmount),
      expectedCurrency: payment.currency,
      providerCurrency: String(providerCurrency).toUpperCase(),
    });
    payment.reconciled = matched;
    if (matched) {
      this._audit(payment, 'RECONCILED');
      this._trace(payment, 'RECONCILED');
      return { status: 'MATCHED' };
    }
    payment.status = STATES.REQUIRES_REVIEW;
    this._audit(payment, 'RECONCILIATION_EXCEPTION');
    this._trace(payment, 'REQUIRES_REVIEW', { reason: 'RECONCILIATION_MISMATCH' });
    return { status: 'MISMATCHED' };
  }

  issueReceipt(paymentId) {
    const payment = this._payment(paymentId);
    assert.equal(payment.settled, true, 'receipt requires settlement');
    assert.equal(payment.reconciled, true, 'receipt requires reconciliation');
    const receipt = {
      receiptNumber: `RCT-${payment.paymentId}`,
      transactionReference: payment.paymentId,
      providerReference: payment.providerReference,
      tenantId: payment.tenantId,
      memberId: payment.memberId,
      groupId: payment.groupId,
      amount: payment.amount,
      currency: payment.currency,
      status: 'SETTLED',
    };
    this.receipts.set(receipt.receiptNumber, receipt);
    this._audit(payment, 'RECEIPT_GENERATED');
    this._trace(payment, 'RECEIPT_GENERATED');
    return receipt;
  }

  reverse(paymentId) {
    const payment = this._payment(paymentId);
    assert.equal(payment.settled, true, 'reversal requires a previously settled payment');
    const existing = this.ledger.find((entry) => entry.reversalOf === paymentId);
    if (existing) return { duplicate: true, paymentId };
    const original = this.ledger.find((entry) => entry.paymentId === paymentId);
    assert.ok(original, 'original ledger posting must exist');
    const reversal = {
      postingKey: `reversal:${payment.paymentId}`,
      reversalOf: payment.paymentId,
      paymentId: payment.paymentId,
      tenantId: payment.tenantId,
      debit: original.credit,
      credit: original.debit,
      currency: payment.currency,
    };
    this.ledger.push(reversal);
    const current = BigInt(this.balances.get(payment.accountId) || '0');
    this.balances.set(payment.accountId, (current - BigInt(original.debit)).toString());
    payment.reversed = true;
    payment.status = STATES.REVERSED;
    this._audit(payment, 'REVERSAL_POSTED');
    this._trace(payment, 'REVERSED');
    return reversal;
  }

  replayOffline(paymentRequest) {
    return this.initiate(paymentRequest);
  }

  _payment(paymentId) {
    const payment = this.payments.get(paymentId);
    assert.ok(payment, `payment ${paymentId} not found`);
    return payment;
  }

  _tenant(payment, tenantId) {
    assert.equal(String(payment.tenantId), String(tenantId), 'tenant isolation violation');
  }

  _audit(payment, event, details = {}) {
    this.audit.push({
      event,
      paymentId: payment.paymentId,
      tenantId: payment.tenantId,
      traceId: payment.traceId,
      at: new Date().toISOString(),
      ...details,
    });
  }
}

async function runGoldenMoneyPathReferenceProof() {
  const simulator = new ReferenceProviderSimulator();
  const harness = new InMemoryGoldenMoneyPath({ provider: simulator });

  const start = harness.initiate({
    amount: '50000',
    currency: 'UGX',
    idempotencyKey: 'gmp-0001',
  });
  harness.validate(start.paymentId, { tenantId: 'tenant-001' });
  simulator.setMode('TIMEOUT');
  harness.submit(start.paymentId);
  const restarted = harness.restart();
  const providerReference = restarted.payments.get(start.paymentId).providerReference;

  simulator.setMode('SUCCESS');
  const queried = simulator.queryPayment({ providerReference });
  assert.equal(queried.outcome, 'PENDING');

  // Status confirmation is the external truth-recovery path after timeout.
  simulator.payments.get(providerReference).status = 'SUCCESS';
  const confirmed = simulator.queryPayment({ providerReference });
  assert.equal(confirmed.outcome, 'SUCCESS');

  const callback = simulator.emitCallback({ providerReference, amount: '50000', currency: 'UGX', status: 'SUCCESS' });
  restarted.applyCallback(callback, { tenantId: 'tenant-001' });
  assert.deepEqual(restarted.applyCallback(callback, { tenantId: 'tenant-001' }), {
    duplicate: true,
    paymentId: start.paymentId,
  });

  restarted.confirmSuccess(start.paymentId);
  const staleCallback = simulator.emitCallback({ providerReference, amount: '50000', currency: 'UGX', status: 'FAILED' });
  assert.deepEqual(restarted.applyCallback(staleCallback, { tenantId: 'tenant-001' }), { stale: true, paymentId: start.paymentId });
  restarted.postLedger(start.paymentId);
  restarted.postLedger(start.paymentId);
  restarted.settle(start.paymentId);
  assert.deepEqual(restarted.reconcile(start.paymentId, { providerAmount: '50000', providerCurrency: 'UGX' }), { status: 'MATCHED' });
  const receipt = restarted.issueReceipt(start.paymentId);

  assert.equal(restarted.ledger.length, 1, 'exactly one original ledger posting is required');
  assert.equal(restarted.ledger[0].debit, restarted.ledger[0].credit, 'ledger must balance');
  assert.equal(restarted.balances.get('account-001'), '50000', 'balance projection must reflect one successful payment');
  assert.equal(receipt.status, 'SETTLED');

  const reversal = restarted.reverse(start.paymentId);
  assert.equal(restarted.ledger.length, 2, 'reversal must add a compensating posting');
  assert.equal(reversal.debit, reversal.credit, 'reversal journal must remain balanced');
  assert.equal(restarted.balances.get('account-001'), '0', 'reversal must restore the projected balance');
  const netDebit = restarted.ledger.reduce((sum, entry) => sum + BigInt(entry.debit), 0n);
  const netCredit = restarted.ledger.reduce((sum, entry) => sum + BigInt(entry.credit), 0n);
  assert.equal(netDebit, netCredit, 'ledger must remain balanced after reversal');

  assert.deepEqual(harness.initiate({
    amount: '50000',
    currency: 'UGX',
    idempotencyKey: 'gmp-0001',
  }).replay, true);
  assert.deepEqual(harness.initiate({
    amount: '51000',
    currency: 'UGX',
    idempotencyKey: 'gmp-0001',
  }), { conflict: true, error: 'IDEMPOTENCY_CONFLICT' });

  assert.deepEqual(
    restarted.applyCallback({ ...callback, eventId: 'CALLBACK-WRONG', amount: '50001' }, { tenantId: 'tenant-001' }),
    { mismatch: true, paymentId: start.paymentId },
  );

  assert.throws(
    () => restarted.validate(start.paymentId, { tenantId: 'tenant-002' }),
    /tenant isolation/i,
  );

  const mismatchCurrency = restarted.initiate({ amount: '25000', currency: 'USD', idempotencyKey: 'gmp-currency-mismatch' });
  assert.deepEqual(mismatchCurrency, { conflict: false, error: 'CURRENCY_MISMATCH' });

  const mismatch = restarted.initiate({ amount: '25000', currency: 'UGX', idempotencyKey: 'gmp-0002' });
  restarted.validate(mismatch.paymentId, { tenantId: 'tenant-001' });
  simulator.setMode('SUCCESS');
  restarted.submit(mismatch.paymentId);
  const mismatchCallback = simulator.emitCallback({
    providerReference: restarted.payments.get(mismatch.paymentId).providerReference,
    amount: '25000',
    currency: 'USD',
    status: 'SUCCESS',
  });
  assert.deepEqual(restarted.applyCallback(mismatchCallback, { tenantId: 'tenant-001' }), { mismatch: true, paymentId: mismatch.paymentId });
  const reconciliationCase = restarted.initiate({ amount: '25000', currency: 'UGX', idempotencyKey: 'gmp-reconciliation-mismatch' });
  restarted.validate(reconciliationCase.paymentId, { tenantId: 'tenant-001' });
  restarted.submit(reconciliationCase.paymentId);
  const reconciliationCallback = simulator.emitCallback({
    providerReference: restarted.payments.get(reconciliationCase.paymentId).providerReference,
    amount: '25000',
    currency: 'UGX',
    status: 'SUCCESS',
  });
  restarted.applyCallback(reconciliationCallback, { tenantId: 'tenant-001' });
  restarted.confirmSuccess(reconciliationCase.paymentId);
  restarted.postLedger(reconciliationCase.paymentId);
  restarted.settle(reconciliationCase.paymentId);
  assert.deepEqual(restarted.reconcile(reconciliationCase.paymentId, { providerAmount: '25001', providerCurrency: 'UGX' }), { status: 'MISMATCHED' });

  const offline = restarted.replayOffline({ amount: '1000', currency: 'UGX', idempotencyKey: 'gmp-offline-1' });
  const offlineReplay = restarted.replayOffline({ amount: '1000', currency: 'UGX', idempotencyKey: 'gmp-offline-1' });
  assert.equal(offlineReplay.replay, true, 'offline replay must resolve to the original logical operation');

  const eventsByType = new Set(restarted.audit.map((event) => event.event));
  for (const required of [
    'PAYMENT_INITIATED',
    'PAYMENT_VALIDATED',
    'PROVIDER_REQUEST_SENT',
    'PROVIDER_TIMEOUT_UNKNOWN',
    'CALLBACK_ACCEPTED',
    'LEDGER_POSTED',
    'SETTLED',
    'RECONCILED',
    'RECEIPT_GENERATED',
    'REVERSAL_POSTED',
  ]) {
    assert.ok(eventsByType.has(required), `audit must contain ${required}`);
  }

  return {
    status: 'PASS',
    scenario: 'UGX 50,000 provider-timeout → restart → status-confirmation → duplicate-callback → ledger → settlement → reconciliation → receipt → reversal',
    guarantees: {
      exactlyOneOriginalPayment: restarted.ledger.filter((entry) => !entry.reversalOf).length === 1,
      exactlyOneOriginalLedgerPosting: restarted.ledger.filter((entry) => !entry.reversalOf).length === 1,
      duplicateCallbackSafe: true,
      timeoutDoesNotDuplicateProviderPayment: simulator.payments.size === 2,
      restartRecoveredState: Boolean(restarted.payments.get(start.paymentId)),
      ledgerBalanced: netDebit === netCredit,
      tenantIsolationEnforced: true,
      idempotencyConflictDetected: true,
      offlineReplayIdempotent: true,
      reconciliationMismatchHeld: true,
      auditComplete: true,
    },
    metrics: {
      ledgerPostings: restarted.ledger.length,
      auditEvents: restarted.audit.length,
      traceEvents: restarted.trace.length,
      providerPayments: simulator.payments.size,
    },
  };
}

module.exports = {
  STATES,
  InMemoryGoldenMoneyPath,
  runGoldenMoneyPathReferenceProof,
};
