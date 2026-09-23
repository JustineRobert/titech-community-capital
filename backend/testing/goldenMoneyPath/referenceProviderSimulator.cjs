'use strict';

/**
 * TITech Community Capital
 * Golden Money Path — deterministic provider simulator (TEST ONLY)
 *
 * This simulator implements the provider contract needed by the reference
 * proof harness without contacting MTN/Airtel or changing production code.
 * It exists solely to exercise timeout, status-query, callback, replay and
 * reversal semantics in CI.
 */

class ReferenceProviderSimulator {
  constructor({ provider = 'MTN_MOMO', currency = 'UGX' } = {}) {
    this.provider = provider;
    this.currency = currency;
    this.payments = new Map();
    this.callbacks = [];
    this.nextReference = 1;
    this.mode = 'SUCCESS';
  }

  setMode(mode) {
    this.mode = String(mode).toUpperCase();
  }

  createPayment({
    paymentId,
    amount,
    currency,
    idempotencyKey,
    tenantId,
  }) {
    if (!paymentId || !idempotencyKey || !tenantId) {
      throw new Error('provider simulator requires payment identity');
    }

    const existing = [...this.payments.values()].find(
      (payment) => payment.idempotencyKey === idempotencyKey,
    );

    if (existing) {
      return {
        outcome: 'DUPLICATE',
        providerReference: existing.providerReference,
        providerStatus: existing.status,
      };
    }

    const providerReference = `${this.provider}-REF-${String(this.nextReference++).padStart(6, '0')}`;
    const status = this.mode === 'TIMEOUT'
      ? 'PENDING'
      : this.mode === 'FAILURE'
        ? 'FAILED'
        : 'SUCCESS';

    const record = {
      paymentId,
      tenantId,
      amount: String(amount),
      currency: String(currency).toUpperCase(),
      idempotencyKey,
      providerReference,
      status,
      callbackCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.payments.set(providerReference, record);

    return {
      outcome: this.mode === 'TIMEOUT' ? 'UNKNOWN' : status,
      providerReference,
      providerStatus: status,
    };
  }

  queryPayment({ providerReference }) {
    const record = this.payments.get(providerReference);
    if (!record) return { outcome: 'UNKNOWN', providerStatus: 'UNKNOWN' };

    return {
      outcome: record.status,
      providerReference,
      providerStatus: record.status,
      amount: record.amount,
      currency: record.currency,
    };
  }

  emitCallback({ providerReference, amount, currency, status = 'SUCCESS' } = {}) {
    const record = this.payments.get(providerReference);
    if (!record) throw new Error('unknown provider reference');

    record.callbackCount += 1;
    const callback = {
      eventId: `CALLBACK-${providerReference}-${record.callbackCount}`,
      provider: this.provider,
      providerReference,
      tenantId: record.tenantId,
      amount: String(amount ?? record.amount),
      currency: String(currency ?? record.currency).toUpperCase(),
      status: String(status).toUpperCase(),
      callbackSequence: record.callbackCount,
    };

    this.callbacks.push(callback);
    return callback;
  }

  reversePayment({ providerReference }) {
    const record = this.payments.get(providerReference);
    if (!record) return { outcome: 'UNKNOWN' };
    record.status = 'REVERSED';
    return {
      outcome: 'REVERSED',
      providerReference,
      providerStatus: record.status,
    };
  }
}

module.exports = {
  ReferenceProviderSimulator,
};
