import test from 'node:test';
import assert from 'node:assert/strict';
import { createTitechFinancialCoreAdapter } from '../../../../commercial/financial/titechFinancialCore.adapter.js';

test('adapter delegates posting to the injected canonical financial core and requires an ID', async () => {
  let observed;
  const adapter = createTitechFinancialCoreAdapter({
    async postCanonicalBillingPayment(input) {
      observed = input;
      return { transactionId: 'txn-900', journalId: 'jrn-900', posted: true };
    },
  });
  const result = await adapter.postBillingPayment({
    tenantId: 'tenant-a',
    invoice: { _id: 'invoice-1', tenantId: 'tenant-a' },
    payment: { _id: 'payment-1', tenantId: 'tenant-a' },
    amount: '1000', currency: 'UGX', provider: 'mtn_momo', idempotencyKey: 'billpay:1',
    session: { inTransaction: () => true },
  });
  assert.equal(result.financialTransactionId, 'txn-900');
  assert.equal(result.posted, true);
  assert.equal(observed.source, 'TITECH_COMMERCIAL_BILLING');
  assert.equal(observed.billingPaymentId, 'payment-1');
});

test('adapter fails closed without canonical posting injection or Mongo session', async () => {
  assert.throws(() => createTitechFinancialCoreAdapter(), /must be wired/);
  const adapter = createTitechFinancialCoreAdapter({ async postCanonicalBillingPayment() { return { transactionId: 'txn' }; } });
  await assert.rejects(adapter.postBillingPayment({
    tenantId: 'tenant-a', invoice: { _id: 'invoice-1', tenantId: 'tenant-a' },
    payment: { _id: 'payment-1', tenantId: 'tenant-a' }, amount: '100', currency: 'UGX', provider: 'mtn', idempotencyKey: 'k',
  }), /active MongoDB transaction session is required/);
});

test('adapter rejects tenant mismatch and missing financial transaction IDs', async () => {
  const adapter = createTitechFinancialCoreAdapter({ async postCanonicalBillingPayment() { return { posted: true }; } });
  await assert.rejects(adapter.postBillingPayment({
    tenantId: 'tenant-a', invoice: { _id: 'invoice-1', tenantId: 'tenant-b' },
    payment: { _id: 'payment-1', tenantId: 'tenant-a' }, amount: '100', currency: 'UGX', provider: 'mtn', idempotencyKey: 'k', session: {},
  }), /Cross-tenant/);
  await assert.rejects(adapter.postBillingPayment({
    tenantId: 'tenant-a', invoice: { _id: 'invoice-1', tenantId: 'tenant-a' },
    payment: { _id: 'payment-1', tenantId: 'tenant-a' }, amount: '100', currency: 'UGX', provider: 'mtn', idempotencyKey: 'k', session: { inTransaction: () => true },
  }), /authoritative financial transaction ID/);
});
